import { invoke } from "@tauri-apps/api/core";

/// Remembered library roots live in the Rust shell, not in localStorage: under
/// the App Store sandbox reopening a folder takes a security-scoped bookmark,
/// and only the shell can mint and resolve one. Most recent first.
export function listRoots(): Promise<string[]> {
  return invoke<string[]>("list_roots");
}

/// Regain access to a remembered root. Call before asking the core to scan it.
export function openRoot(path: string): Promise<void> {
  return invoke<void>("open_root", { path });
}

export function rememberRoot(path: string): Promise<void> {
  return invoke<void>("remember_root", { path });
}
