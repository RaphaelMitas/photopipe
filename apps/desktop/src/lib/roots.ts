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

export function pickFolder(title: string): Promise<string | null> {
  return invoke("pick_folder", { title });
}

export async function openRoot(
  path?: string,
): Promise<(SetRootResult & { path: string }) | null> {
  const chosen = path ?? (await pickFolder("Choose your photos folder"));
  return chosen === null ? null : invoke("open_root", { path: chosen });
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
