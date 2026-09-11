import { invoke } from "@tauri-apps/api/core";
import type { SetRootResult } from "./core";

export type RootStatus = "ok" | "unplugged" | "broken";

export type RootEntry = {
  path: string;
  name: string;
  status: RootStatus;
};

export type RootErrorKind = "unplugged" | "denied" | "broken" | "failed";

export type RootError = {
  kind: RootErrorKind;
  message: string;
};

export type OpenedRoot = SetRootResult & { path: string };

export function listRoots(): Promise<RootEntry[]> {
  return invoke<RootEntry[]>("list_roots");
}

/// Without a path the shell shows the folder panel; null means it was
/// cancelled.
export function openRoot(path?: string): Promise<OpenedRoot | null> {
  return invoke<OpenedRoot | null>("open_root", { path: path ?? null });
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
    const { kind } = error;
    if (
      kind === "unplugged" ||
      kind === "denied" ||
      kind === "broken" ||
      kind === "failed"
    ) {
      return { kind, message: error.message };
    }
  }
  return { kind: "failed", message: String(error) };
}
