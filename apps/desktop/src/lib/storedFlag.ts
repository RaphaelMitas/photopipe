import { useSyncExternalStore } from "react";

export function storedFlag(key: string, fallback: boolean) {
  const listeners = new Set<() => void>();
  const read = () => {
    const stored = localStorage.getItem(key);
    return stored === null ? fallback : stored === "on";
  };
  const set = (on: boolean) => {
    localStorage.setItem(key, on ? "on" : "off");
    for (const listener of listeners) listener();
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  return { read, set, use: () => useSyncExternalStore(subscribe, read) };
}
