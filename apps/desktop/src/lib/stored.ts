import { useSyncExternalStore } from "react";

export function stored<T>(
  key: string,
  parse: (raw: string | null) => T,
  serialize: (value: T) => string = String,
) {
  const listeners = new Set<() => void>();
  const read = () => parse(localStorage.getItem(key));
  const set = (value: T) => {
    localStorage.setItem(key, serialize(value));
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

export function storedFlag(key: string, fallback: boolean) {
  return stored(
    key,
    (raw) => (raw === null ? fallback : raw === "on"),
    (on) => (on ? "on" : "off"),
  );
}
