import type { LucideIcon } from "lucide-react";
import { useSyncExternalStore } from "react";

// Entries put their values into a channel, and a channel writes what it holds
// as one batch: a jump over a thousand ratings is one write per photo.
export type HistoryChannel = { flush: () => Promise<unknown> };

export type HistoryAction = {
  icon: LucideIcon;
  label: string;
  detail?: string;
  paths: string[];
  channel: HistoryChannel;
  // absolute values, so a batch and a step-by-step replay end the same
  stage: (direction: HistoryDirection, path: string) => void;
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
type Asked = { pushes: number; clears: number };

// `asked` is the timeline the move was aimed at: acting again calls it off.
async function travel(target: number, asked: Asked, onStart?: OnStart) {
  const stale = () => asked.pushes !== pushes || asked.clears !== clears;
  if (stale() || target < 0 || target > state.entries.length) return [];
  const direction = target < state.cursor ? "undo" : "redo";
  const run =
    direction === "undo"
      ? state.entries.slice(target, state.cursor).reverse()
      : state.entries.slice(state.cursor, target);
  if (run.length === 0) return [];
  onStart?.(run[0]);

  const written = await Promise.allSettled(run.map((entry) => entry.written));
  if (stale()) return [];
  const unwritten = run.filter((_, i) => written[i].status === "rejected");
  if (unwritten.length > 0) {
    rewrite((entry) => (unwritten.includes(entry) ? null : entry));
    return [];
  }

  // in travel order, so the value a replay would write last is the one staged last
  for (const entry of run) {
    for (const path of entry.paths) entry.stage(direction, path);
  }
  const channels = new Set(run.map((entry) => entry.channel));
  const flushed = await Promise.allSettled(
    Array.from(channels, (channel) => channel.flush()),
  );
  if (flushed.some((result) => result.status === "rejected")) {
    // a step that cannot run would block everything under it
    if (run.length === 1) drop(run[0].id);
    return [];
  }
  if (asked.clears !== clears) return [];
  setState({ ...state, cursor: target });
  return run;
}

export function stepHistory(direction: HistoryDirection, onStart?: OnStart) {
  const asked = { pushes, clears };
  return enqueue(async () => {
    const target = state.cursor + (direction === "undo" ? -1 : 1);
    const [entry = null] = await travel(target, asked, onStart);
    return entry;
  });
}

export function jumpHistory(cursor: number) {
  const asked = { pushes, clears };
  return enqueue(async () => (await travel(cursor, asked)).length);
}
