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

export function pushHistory(action: HistoryAction) {
  const entry = { ...action, id: nextId++, at: Date.now() };
  setState({
    entries: [...state.entries.slice(0, state.cursor), entry],
    cursor: state.cursor + 1,
  });
}

export function clearHistory() {
  setState({ entries: [], cursor: 0 });
}

async function step(direction: "undo" | "redo"): Promise<HistoryEntry | null> {
  const index = direction === "undo" ? state.cursor - 1 : state.cursor;
  const entry = state.entries[index];
  if (!entry) return null;
  try {
    await entry[direction]();
  } catch {
    return null;
  }
  // A clear or a push while the write ran replaced the timeline.
  if (state.entries[index] !== entry) return null;
  setState({
    ...state,
    cursor: direction === "undo" ? index : index + 1,
  });
  return entry;
}

function enqueue<T>(run: () => Promise<T>): Promise<T> {
  const done = queue.then(run);
  queue = done.catch(() => undefined);
  return done;
}

export const undoHistory = () => enqueue(() => step("undo"));
export const redoHistory = () => enqueue(() => step("redo"));

export function jumpHistory(cursor: number) {
  return enqueue(async () => {
    let last: HistoryEntry | null = null;
    while (state.cursor !== cursor) {
      const moved = await step(state.cursor > cursor ? "undo" : "redo");
      if (!moved) break;
      last = moved;
    }
    return last;
  });
}
