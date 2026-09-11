import { useSyncExternalStore } from "react";
import { storedFlag } from "@/lib/storedFlag";

export type RawDecoderVersion = 8 | 9;

const VERSION_KEY = "photopipe.rawDecoder";

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

const quickSwitch = storedFlag("photopipe.rawDecoderQuickSwitch", true);
export const setRawDecoderQuickSwitch = quickSwitch.set;
export const useRawDecoderQuickSwitch = quickSwitch.use;
