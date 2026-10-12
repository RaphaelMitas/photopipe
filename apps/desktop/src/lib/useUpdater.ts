import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check as findUpdate, type Update } from "@tauri-apps/plugin-updater";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

/// One toast id for the whole update conversation, so a download replaces the
/// offer rather than stacking under it.
const UPDATE_TOAST = "update";

type Options = {
  blockedReason: string | null;
  beforeInstall: () => void;
};

function updatable(): boolean {
  return import.meta.env.PROD && import.meta.env.VITE_E2E !== "1";
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function showProgress(percent: number | null) {
  toast.loading(
    percent === null
      ? "Downloading update…"
      : `Downloading update… ${percent}%`,
    { id: UPDATE_TOAST, duration: Number.POSITIVE_INFINITY },
  );
}

export function useUpdater(options: Options) {
  const [enabled, setEnabled] = useState(false);
  const pending = useRef<Update | null>(null);
  // the offer toast outlives the render that made it, so Install reads this
  const live = useRef({ ...options, enabled });
  live.current = { ...options, enabled };

  useEffect(() => {
    invoke<boolean>("updater_available").then(setEnabled, () =>
      setEnabled(false),
    );
  }, []);

  // Sonner dismisses the toast the moment Install is clicked, so anything that
  // stops the install has to say so itself or it happens in silence.
  const install = useCallback(async () => {
    const { blockedReason, beforeInstall } = live.current;
    if (blockedReason) {
      toast.error(blockedReason, { id: UPDATE_TOAST });
      return;
    }
    beforeInstall();
    const update = pending.current;
    pending.current = null;
    if (!update) {
      toast.error(
        "Install failed: That update is no longer available. Check again.",
        { id: UPDATE_TOAST },
      );
      return;
    }
    showProgress(null);
    try {
      let total = 0;
      let done = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        if (event.event === "Progress") done += event.data.chunkLength;
        showProgress(total > 0 ? Math.round((done / total) * 100) : null);
      });
      toast.success("Update installed, restarting…", { id: UPDATE_TOAST });
      await relaunch();
    } catch (error) {
      toast.error(`Install failed: ${message(error)}`, { id: UPDATE_TOAST });
    }
  }, []);

  const offer = useCallback(
    (version: string) => {
      toast(`Photopipe ${version} is available`, {
        id: UPDATE_TOAST,
        duration: Number.POSITIVE_INFINITY,
        action: { label: "Install", onClick: () => void install() },
      });
    },
    [install],
  );

  const find = useCallback(async () => {
    const update = await findUpdate();
    await pending.current?.close();
    pending.current = update;
    return update;
  }, []);

  useEffect(() => {
    if (!enabled || !updatable()) return;
    find().then(
      (update) => {
        if (update) offer(update.version);
      },
      () => {},
    );
  }, [enabled, find, offer]);

  const check = useCallback(async () => {
    if (!live.current.enabled || !updatable()) {
      toast.error("Not a release build.", { id: UPDATE_TOAST });
      return;
    }
    toast.loading("Checking for updates…", { id: UPDATE_TOAST });
    try {
      const update = await find();
      if (update) offer(update.version);
      else toast.success("Photopipe is up to date", { id: UPDATE_TOAST });
    } catch (error) {
      toast.error(message(error), { id: UPDATE_TOAST });
    }
  }, [find, offer]);

  return { enabled, check };
}
