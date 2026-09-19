import type { LucideIcon } from "lucide-react";
import { useSyncExternalStore } from "react";

export type HistoryAction = {
  icon: LucideIcon;
  label: string;
  detail?: string;
  paths: string[];
  // `paths` is what is left of the entry's photos once some were trashed
  undo: (paths: string[]) => Promise<unknown>;
  redo: (paths: string[]) => Promise<unknown>;
  // the write that made the entry: undo waits for it, its failure drops the entry
  written?: Promise<unknown>;
};

export type HistoryEntry = HistoryAction & { id: number; at: number };
export type HistoryDirection = "undo" | "redo";

// cursor counts applied entries; everything from entries[cursor] on is undone
type HistoryState = { entries: HistoryEntry[]; cursor: number };

let state: HistoryState = { entries: [], cursor: 0 };
let nextId = 1;
let clears = 0;
let pushes = 0;
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

function drop(gone: (entry: HistoryEntry) => boolean) {
  const kept = state.entries.map((entry) => !gone(entry));
  setState({
    entries: state.entries.filter((_, index) => kept[index]),
    cursor: kept.slice(0, state.cursor).filter(Boolean).length,
  });
}

// queued: pushed mid-undo it would land above the entry being undone
export function pushHistory(action: HistoryAction) {
  const entry = { ...action, id: nextId++, at: Date.now() };
  const clearsAtStart = clears;
  // steps still waiting were aimed at a timeline this action is about to change
  pushes += 1;
  void action.written?.catch(() =>
    enqueue(() => drop((other) => other.id === entry.id)),
  );
  return enqueue(() => {
    if (clearsAtStart !== clears) return;
    setState({
      entries: [...state.entries.slice(0, state.cursor), entry],
      cursor: state.cursor + 1,
    });
  });
}

export function clearHistory() {
  clears += 1;
  setState({ entries: [], cursor: 0 });
}

export function forgetHistoryPaths(paths: string[]) {
  const gone = new Set(paths);
  return enqueue(() => {
    const emptied = new Set<number>();
    const entries = state.entries.map((entry) => {
      const left = entry.paths.filter((path) => !gone.has(path));
      if (left.length === 0 && entry.paths.length > 0) emptied.add(entry.id);
      return left.length === entry.paths.length
        ? entry
        : { ...entry, paths: left };
    });
    setState({ ...state, entries });
    drop((entry) => emptied.has(entry.id));
  });
}

type OnStart = (entry: HistoryEntry) => void;

async function step(
  direction: HistoryDirection,
  onStart?: OnStart,
): Promise<HistoryEntry | null> {
  const index = direction === "undo" ? state.cursor - 1 : state.cursor;
  const entry = state.entries[index];
  if (!entry) return null;
  onStart?.(entry);
  const clearsAtStart = clears;
  try {
    await entry.written?.catch(() => undefined);
    await entry[direction](entry.paths);
  } catch {
    // a step that cannot run would block everything under it
    drop((other) => other.id === entry.id);
    return null;
  }
  if (clearsAtStart !== clears) return null;
  setState({
    ...state,
    cursor: direction === "undo" ? index : index + 1,
  });
  return entry;
}

export function stepHistory(direction: HistoryDirection, onStart?: OnStart) {
  const pushesAtStart = pushes;
  return enqueue(() =>
    pushesAtStart === pushes ? step(direction, onStart) : null,
  );
}

export function jumpHistory(cursor: number) {
  const pushesAtStart = pushes;
  return enqueue(async () => {
    let steps = 0;
    while (state.cursor !== cursor && pushesAtStart === pushes) {
      const moved = await step(state.cursor > cursor ? "undo" : "redo");
      if (!moved) break;
      steps += 1;
    }
    return steps;
  });
}
