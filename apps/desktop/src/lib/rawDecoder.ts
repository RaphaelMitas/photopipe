import { useSyncExternalStore } from "react";

/// a session mode, not a per-photo property, so it stays out of Edit
export type RawDecoderVersion = 8 | 9;

const VERSION_KEY = "photopipe.rawDecoder";
const QUICK_SWITCH_KEY = "photopipe.rawDecoderQuickSwitch";

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function rawDecoderVersion(): RawDecoderVersion {
  return localStorage.getItem(VERSION_KEY) === "8" ? 8 : 9;
}

export function setRawDecoderVersion(version: RawDecoderVersion) {
  localStorage.setItem(VERSION_KEY, String(version));
  emit();
}

export function useRawDecoderVersion(): RawDecoderVersion {
  return useSyncExternalStore(subscribe, rawDecoderVersion);
}

export function rawDecoderQuickSwitch(): boolean {
  return localStorage.getItem(QUICK_SWITCH_KEY) === "on";
}

export function setRawDecoderQuickSwitch(on: boolean) {
  localStorage.setItem(QUICK_SWITCH_KEY, on ? "on" : "off");
  emit();
}

export function useRawDecoderQuickSwitch(): boolean {
  return useSyncExternalStore(subscribe, rawDecoderQuickSwitch);
}
