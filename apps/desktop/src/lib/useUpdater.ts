import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { useCallback, useEffect, useRef, useState } from "react";

export type UpdateState =
  | { kind: "idle" }
  | { kind: "current" }
  | { kind: "available"; version: string; notes: string }
  | { kind: "downloading"; percent: number | null }
  | { kind: "installed" }
  | { kind: "error"; message: string };

export type Updater = {
  /// False in the App Store build, where the updater is compiled out.
  available: boolean;
  state: UpdateState;
  /// Both resolve with what happened, so the caller can report it in the toast
  /// it already opened rather than watching `state` change.
  check: () => Promise<UpdateState>;
  install: () => Promise<UpdateState>;
};

function updatable(): boolean {
  return import.meta.env.PROD && import.meta.env.VITE_E2E !== "1";
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useUpdater(): Updater {
  const [available, setAvailable] = useState(false);
  const [state, setState] = useState<UpdateState>({ kind: "idle" });
  const pending = useRef<Update | null>(null);

  useEffect(() => {
    invoke<boolean>("updater_available").then(setAvailable, () =>
      setAvailable(false),
    );
  }, []);

  const run = useCallback(
    async (silent: boolean): Promise<UpdateState> => {
      if (!available || !updatable()) {
        const blocked: UpdateState = {
          kind: "error",
          message: available
            ? "Not a release build."
            : "Updates come through the App Store.",
        };
        if (!silent) setState(blocked);
        return blocked;
      }
      try {
        const update = await check();
        await pending.current?.close();
        pending.current = update;
        const found: UpdateState = update
          ? {
              kind: "available",
              version: update.version,
              notes: update.body ?? "",
            }
          : { kind: "current" };
        setState(found);
        return found;
      } catch (error) {
        const failed: UpdateState = { kind: "error", message: message(error) };
        if (!silent) setState(failed);
        return failed;
      }
    },
    [available],
  );

  useEffect(() => {
    if (available) void run(true);
  }, [available, run]);

  const install = useCallback(async (): Promise<UpdateState> => {
    const update = pending.current;
    pending.current = null;
    if (!update) {
      const gone: UpdateState = {
        kind: "error",
        message: "That update is no longer available. Check again.",
      };
      setState(gone);
      return gone;
    }
    setState({ kind: "downloading", percent: null });
    try {
      let total = 0;
      let done = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        if (event.event === "Progress") done += event.data.chunkLength;
        setState({
          kind: "downloading",
          percent: total > 0 ? Math.round((done / total) * 100) : null,
        });
      });
      setState({ kind: "installed" });
      await relaunch();
      return { kind: "installed" };
    } catch (error) {
      const failed: UpdateState = { kind: "error", message: message(error) };
      setState(failed);
      return failed;
    }
  }, []);

  return {
    available,
    state,
    check: useCallback(() => run(false), [run]),
    install,
  };
}
