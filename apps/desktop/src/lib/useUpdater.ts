import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { useCallback, useEffect, useRef, useState } from "react";

export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current" }
  | { kind: "available"; version: string; notes: string }
  | { kind: "downloading"; percent: number | null }
  | { kind: "installed" }
  | { kind: "error"; message: string };

export type Updater = {
  state: UpdateState;
  check: () => Promise<void>;
  install: () => Promise<void>;
};

// A dev build has no signed bundle to replace and the e2e mock only answers
// core_request, so a check in either would only ever produce a red herring.
function updatable(): boolean {
  return import.meta.env.PROD && import.meta.env.VITE_E2E !== "1";
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Checks once on mount, silently: no network, no release yet or a malformed
 * manifest all mean "nothing to offer", which is not worth interrupting anyone
 * over. A check the user asked for reports what went wrong.
 */
export function useUpdater(): Updater {
  const [state, setState] = useState<UpdateState>({ kind: "idle" });
  const pending = useRef<Update | null>(null);

  const run = useCallback(async (silent: boolean) => {
    if (!updatable()) {
      if (!silent) setState({ kind: "error", message: "Not a release build." });
      return;
    }
    if (!silent) setState({ kind: "checking" });
    try {
      const update = await check();
      pending.current = update;
      setState(
        update
          ? {
              kind: "available",
              version: update.version,
              notes: update.body ?? "",
            }
          : { kind: "current" },
      );
    } catch (error) {
      if (!silent) setState({ kind: "error", message: message(error) });
    }
  }, []);

  useEffect(() => {
    void run(true);
  }, [run]);

  const install = useCallback(async () => {
    const update = pending.current;
    if (!update) return;
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
    } catch (error) {
      setState({ kind: "error", message: message(error) });
    }
  }, []);

  return { state, check: useCallback(() => run(false), [run]), install };
}
