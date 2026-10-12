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

function say(show: typeof toast.success, text: string, sticky = false) {
  show(text, {
    id: UPDATE_TOAST,
    action: undefined,
    duration: sticky ? Number.POSITIVE_INFINITY : undefined,
  });
}

function showProgress(percent: number | null) {
  say(
    toast.loading,
    percent === null
      ? "Downloading update…"
      : `Downloading update… ${percent}%`,
    true,
  );
}

export function useUpdater(options: Options) {
  const [enabled, setEnabled] = useState(false);
  const pending = useRef<Update | null>(null);
  const startupOfferSuppressed = useRef(false);
  // read at call time: the offer toast's Install outlives its render, and check must stay stable for App's menu listener
  const live = useRef({ ...options, enabled });
  live.current = { ...options, enabled };

  useEffect(() => {
    invoke<boolean>("updater_available").then(setEnabled, () =>
      setEnabled(false),
    );
  }, []);

  const install = useCallback(async () => {
    startupOfferSuppressed.current = true;
    const { blockedReason, beforeInstall } = live.current;
    if (blockedReason) {
      toast.error(blockedReason, { id: UPDATE_TOAST });
      return;
    }
    beforeInstall();
    const update = pending.current;
    pending.current = null;
    try {
      if (!update) {
        throw new Error("That update is no longer available. Check again.");
      }
      showProgress(null);
      let total = 0;
      let done = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        if (event.event === "Progress") done += event.data.chunkLength;
        showProgress(total > 0 ? Math.round((done / total) * 100) : null);
      });
      say(toast.success, "Update installed, restarting…");
      await relaunch();
    } catch (error) {
      say(toast.error, `Install failed: ${message(error)}`);
    }
  }, []);

  const offer = useCallback(
    (version: string) => {
      toast(`Photopipe ${version} is available`, {
        id: UPDATE_TOAST,
        duration: Number.POSITIVE_INFINITY,
        action: {
          label: "Install",
          onClick: (event) => {
            // Sonner would delete whatever install() just posted under this id
            event.preventDefault();
            void install();
          },
        },
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
        if (update && !startupOfferSuppressed.current) offer(update.version);
      },
      () => {},
    );
  }, [enabled, find, offer]);

  const check = useCallback(async () => {
    startupOfferSuppressed.current = true;
    if (!live.current.enabled || !updatable()) {
      say(toast.error, "Not a release build.");
      return;
    }
    say(toast.loading, "Checking for updates…");
    try {
      const update = await find();
      if (update) offer(update.version);
      else say(toast.success, "Photopipe is up to date");
    } catch (error) {
      say(toast.error, message(error));
    }
  }, [find, offer]);

  return { enabled, check };
}
