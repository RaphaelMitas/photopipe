import type { LucideIcon } from "lucide-react";
import { useSyncExternalStore } from "react";

export type HistoryAction = {
  icon: LucideIcon;
  label: string;
  detail?: string;
  paths: string[];
  undo: () => Promise<unknown>;
  redo: () => Promise<unknown>;
};

export type HistoryEntry = HistoryAction & { id: number; at: number };

// cursor counts applied entries; everything from entries[cursor] on is undone
export type HistoryState = { entries: HistoryEntry[]; cursor: number };

let state: HistoryState = { entries: [], cursor: 0 };
let nextId = 1;
let epoch = 0;
// One step at a time: a second ⌘Z has to see the cursor the first one left.
let queue: Promise<unknown> = Promise.resolve();
const listeners = new Set<() => void>();

function setState(next: HistoryState) {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const historyState = () => state;

export function useHistory(): HistoryState {
  return useSyncExternalStore(subscribe, historyState);
}

function enqueue<T>(run: () => Promise<T> | T): Promise<T> {
  const done = queue.then(run);
  queue = done.catch(() => undefined);
  return done;
}

export const historyEpoch = () => epoch;

// Queued: pushed mid-undo it would sit above the entry being undone and read as undone.
// `since` lets a slow action refuse a timeline that was cleared while it ran.
export function pushHistory(action: HistoryAction, since = epoch) {
  const entry = { ...action, id: nextId++, at: Date.now() };
  return enqueue(() => {
    if (since !== epoch) return;
    setState({
      entries: [...state.entries.slice(0, state.cursor), entry],
      cursor: state.cursor + 1,
    });
  });
}

export function clearHistory() {
  epoch += 1;
  setState({ entries: [], cursor: 0 });
}

// Trashed photos: an entry that can only fail would block everything under it.
export function forgetHistoryPaths(paths: string[]) {
  const gone = new Set(paths);
  return enqueue(() => {
    const kept = state.entries.map(
      (entry) =>
        entry.paths.length === 0 || entry.paths.some((path) => !gone.has(path)),
    );
    setState({
      entries: state.entries.filter((_, index) => kept[index]),
      cursor: kept.slice(0, state.cursor).filter(Boolean).length,
    });
  });
}

type OnStart = (entry: HistoryEntry) => void;

async function step(
  direction: "undo" | "redo",
  onStart?: OnStart,
): Promise<HistoryEntry | null> {
  const index = direction === "undo" ? state.cursor - 1 : state.cursor;
  const entry = state.entries[index];
  if (!entry) return null;
  onStart?.(entry);
  try {
    await entry[direction]();
  } catch {
    return null;
  }
  // cleared while the write ran
  if (state.entries[index] !== entry) return null;
  setState({
    ...state,
    cursor: direction === "undo" ? index : index + 1,
  });
  return entry;
}

export const undoHistory = (onStart?: OnStart) =>
  enqueue(() => step("undo", onStart));
export const redoHistory = (onStart?: OnStart) =>
  enqueue(() => step("redo", onStart));

export function jumpHistory(cursor: number) {
  return enqueue(async () => {
    let steps = 0;
    while (state.cursor !== cursor) {
      const moved = await step(state.cursor > cursor ? "undo" : "redo");
      if (!moved) break;
      steps += 1;
    }
    return steps;
  });
}
