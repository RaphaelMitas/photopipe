import { invoke } from "@tauri-apps/api/core";

/// Most recent first.
export function listRoots(): Promise<string[]> {
  return invoke<string[]>("list_roots");
}

/// Call before asking the core to scan it.
export function openRoot(path: string): Promise<void> {
  return invoke<void>("open_root", { path });
}

export function rememberRoot(path: string): Promise<void> {
  return invoke<void>("remember_root", { path });
}
