import { useSyncExternalStore } from "react";

export function pref<T>(
  key: string,
  decode: (raw: string | null) => T,
  encode: (value: T) => string,
) {
  const listeners = new Set<() => void>();
  // useSyncExternalStore loops on a snapshot that is a fresh object each read
  let cached: { raw: string | null; value: T } | null = null;

  const get = () => {
    const raw = localStorage.getItem(key);
    if (cached === null || cached.raw !== raw) {
      cached = { raw, value: decode(raw) };
    }
    return cached.value;
  };

  const set = (value: T) => {
    localStorage.setItem(key, encode(value));
    for (const listener of listeners) listener();
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  return { get, set, use: () => useSyncExternalStore(subscribe, get) };
}

export const flagPref = (
  key: string,
  on: string,
  off: string,
  defaultOn: boolean,
) =>
  pref(
    key,
    (raw) => (defaultOn ? raw !== off : raw === on),
    (value) => (value ? on : off),
  );
