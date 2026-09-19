import { queryOptions } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { SetRootResult } from "./core";

export type RootEntry = {
  path: string;
  status: "ok" | "unplugged" | "broken";
};

const KINDS = ["unplugged", "missing", "denied", "broken", "failed"] as const;

export type RootError = {
  kind: (typeof KINDS)[number];
  message: string;
};

export const rootsQuery = queryOptions({
  queryKey: ["roots"],
  queryFn: () => invoke<RootEntry[]>("list_roots"),
});

/// Without a path the shell shows the folder panel; null means it was
/// cancelled.
export function openRoot(
  path?: string,
): Promise<(SetRootResult & { path: string }) | null> {
  return invoke("open_root", { path: path ?? null });
}

export function forgetRoot(path: string): Promise<void> {
  return invoke("forget_root", { path });
}

export function toRootError(error: unknown): RootError {
  if (
    typeof error === "object" &&
    error !== null &&
    "kind" in error &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    const kind = KINDS.find((known) => known === error.kind);
    if (kind) return { kind, message: error.message };
  }
  return { kind: "failed", message: String(error) };
}
