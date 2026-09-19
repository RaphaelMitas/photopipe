import type { LucideIcon } from "lucide-react";
import { useSyncExternalStore } from "react";

export type HistoryAction = {
  icon: LucideIcon;
  label: string;
  detail?: string;
  paths: string[];
  undo: (remainingPaths: string[]) => Promise<unknown>;
  redo: (remainingPaths: string[]) => Promise<unknown>;
  // the write that made the entry: undo waits for it, its failure drops the entry
  written?: Promise<unknown>;
};

export type HistoryEntry = HistoryAction & { id: number; at: number };
export type HistoryDirection = "undo" | "redo";

export const historyLabel = (entry: HistoryEntry) =>
  [entry.label, entry.detail].filter(Boolean).join(" ");

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

function rewrite(keep: (entry: HistoryEntry) => HistoryEntry | null) {
  const entries = state.entries.map(keep);
  setState({
    entries: entries.filter((entry) => entry !== null),
    cursor: entries.slice(0, state.cursor).filter(Boolean).length,
  });
}

const drop = (id: number) =>
  rewrite((entry) => (entry.id === id ? null : entry));

// queued: pushed mid-undo it would land above the entry being undone
export function pushHistory(action: HistoryAction) {
  const entry = { ...action, id: nextId++, at: Date.now() };
  const clearsAtStart = clears;
  // steps still waiting were aimed at a timeline this action is about to change
  pushes += 1;
  void action.written?.catch(() => enqueue(() => drop(entry.id)));
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
  return enqueue(() =>
    rewrite((entry) => {
      const left = entry.paths.filter((path) => !gone.has(path));
      if (left.length === entry.paths.length) return entry;
      return left.length === 0 ? null : { ...entry, paths: left };
    }),
  );
}

type OnStart = (entry: HistoryEntry) => void;

// `asked` is the timeline the step was aimed at: acting again calls it off.
async function step(
  direction: HistoryDirection,
  asked: { pushes: number; clears: number },
  onStart?: OnStart,
): Promise<HistoryEntry | null> {
  const stale = () => asked.pushes !== pushes || asked.clears !== clears;
  const index = direction === "undo" ? state.cursor - 1 : state.cursor;
  const entry = state.entries[index];
  if (!entry || stale()) return null;
  onStart?.(entry);
  try {
    await entry.written;
    if (stale()) return null;
    await entry[direction](entry.paths);
  } catch {
    // a step that cannot run would block everything under it
    drop(entry.id);
    return null;
  }
  if (asked.clears !== clears) return null;
  setState({
    ...state,
    cursor: direction === "undo" ? index : index + 1,
  });
  return entry;
}

export function stepHistory(direction: HistoryDirection, onStart?: OnStart) {
  const asked = { pushes, clears };
  return enqueue(() => step(direction, asked, onStart));
}

export function jumpHistory(cursor: number) {
  const asked = { pushes, clears };
  return enqueue(async () => {
    let steps = 0;
    while (state.cursor !== cursor) {
      const moved = await step(state.cursor > cursor ? "undo" : "redo", asked);
      if (!moved) break;
      steps += 1;
    }
    return steps;
  });
}
