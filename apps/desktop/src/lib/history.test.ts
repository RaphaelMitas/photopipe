import { Star } from "lucide-react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearHistory,
  forgetHistoryPaths,
  historyChannel,
  historyState,
  jumpHistory,
  type Recorded,
  stepHistory,
} from "./history";

let disk = new Map<string, number>();
let flushes: Map<string, number>[] = [];
let failing = false;
let holdFlush: Promise<void> | null = null;

const channel = historyChannel(async (values: Map<string, number>) => {
  await holdFlush;
  if (failing) throw new Error("disk");
  flushes.push(values);
  for (const [path, value] of values) disk.set(path, value);
});

const push = (action: Partial<Recorded>, undo = new Map(), redo = new Map()) =>
  channel.record(
    { icon: Star, label: "step", paths: [...undo.keys()], ...action },
    undo,
    redo,
  );

function set(next: number, paths = ["a.arw"]) {
  const before = new Map(paths.map((path) => [path, disk.get(path) ?? 0]));
  for (const path of paths) disk.set(path, next);
  void push(
    { label: `set ${next}` },
    before,
    new Map(paths.map((path) => [path, next])),
  );
}

const labels = () => historyState().entries.map((entry) => entry.label);
const tick = () => new Promise((resolve) => setTimeout(resolve));

// after the queued pushes have landed, so the entry exists to jump to
const jumpTo = async (applied: number) => {
  await tick();
  return jumpHistory(historyState().entries[applied - 1] ?? null);
};

describe("history", () => {
  beforeEach(() => {
    clearHistory();
    disk = new Map();
    flushes = [];
    failing = false;
    holdFlush = null;
  });

  it("walks back and forward through what was done", async () => {
    set(1);
    set(2);
    await stepHistory("undo");
    expect(disk.get("a.arw")).toBe(1);
    await stepHistory("redo");
    expect(disk.get("a.arw")).toBe(2);
    expect(await stepHistory("redo")).toBeNull();
  });

  it("runs quick presses one after the other", async () => {
    set(1);
    set(2);
    set(3);
    await Promise.all([
      stepHistory("undo"),
      stepHistory("undo"),
      stepHistory("undo"),
    ]);
    expect(disk.get("a.arw")).toBe(0);
    expect(historyState().cursor).toBe(0);
  });

  it("jumps with one write per photo and lands where a replay would", async () => {
    set(1, ["a.arw"]);
    set(2, ["a.arw", "b.arw"]);
    set(3, ["b.arw"]);
    set(4, ["a.arw"]);
    await jumpTo(1);
    expect(flushes).toEqual([
      new Map([
        ["a.arw", 1],
        ["b.arw", 0],
      ]),
    ]);

    const batched = new Map(disk);
    await jumpTo(4);
    for (let cursor = 4; cursor > 1; cursor--) await stepHistory("undo");
    expect(disk).toEqual(batched);

    await jumpTo(4);
    expect(disk).toEqual(
      new Map([
        ["a.arw", 4],
        ["b.arw", 3],
      ]),
    );
  });

  it("drops the undone entries when something new happens", async () => {
    set(1);
    set(2);
    await stepHistory("undo");
    set(5);
    await stepHistory("redo");
    expect(labels()).toEqual(["set 1", "set 5"]);
  });

  it("drops a step that cannot run so it does not block the ones under it", async () => {
    set(1);
    set(2);
    failing = true;
    expect(await stepHistory("undo")).toBeNull();
    failing = false;
    await stepHistory("undo");
    expect(disk.get("a.arw")).toBe(0);
    expect(labels()).toEqual(["set 1"]);
  });

  it("leaves the timeline alone when a whole jump fails", async () => {
    set(1);
    set(2);
    set(3);
    failing = true;
    expect(await jumpTo(0)).toBe(0);
    expect(historyState().cursor).toBe(3);
    expect(labels()).toEqual(["set 1", "set 2", "set 3"]);
  });

  it("drops an entry whose own write failed", async () => {
    set(1);
    await push({
      label: "never landed",
      written: Promise.reject(new Error("disk")),
    });
    await tick();
    expect(labels()).toEqual(["set 1"]);
    expect(historyState().cursor).toBe(1);
  });

  it("cancels the undos still waiting once you act again", async () => {
    set(1);
    set(2);
    set(3);
    const waiting = [stepHistory("undo"), stepHistory("undo")];
    set(5);
    await Promise.all(waiting);
    await tick();
    expect(disk.get("a.arw")).toBe(5);
    expect(labels()).toEqual(["set 1", "set 2", "set 3", "set 5"]);
  });

  it("keeps an action taken during an undo applied", async () => {
    set(1);
    let finishFlush = () => {};
    holdFlush = new Promise<void>((resolve) => {
      finishFlush = resolve;
    });
    const undone = stepHistory("undo");
    await tick();
    holdFlush = null;
    set(7, ["b.arw"]);
    finishFlush();
    await undone;
    await tick();
    expect(labels()).toEqual(["set 7"]);
    expect(historyState().cursor).toBe(1);
  });

  it("calls off an undo that was still waiting for the entry's own write", async () => {
    let finishWrite = () => {};
    await push(
      {
        label: "long paste",
        written: new Promise<void>((resolve) => {
          finishWrite = resolve;
        }),
      },
      new Map([["a.arw", -1]]),
    );
    const step = stepHistory("undo");
    await tick();
    set(9);
    finishWrite();
    expect(await step).toBeNull();
    expect(flushes).toEqual([]);
    expect(disk.get("a.arw")).toBe(9);
  });

  it("forgets trashed photos and keeps the rest of a batch", async () => {
    set(1, ["kept.arw"]);
    set(2, ["trashed.arw"]);
    set(3, ["kept.arw", "trashed.arw"]);
    await forgetHistoryPaths(["trashed.arw"]);
    expect(labels()).toEqual(["set 1", "set 3"]);
    expect(historyState().cursor).toBe(2);

    await stepHistory("undo");
    expect(flushes).toEqual([new Map([["kept.arw", 1]])]);
  });

  it("refuses an action whose push lands after the timeline was cleared", async () => {
    const pushed = push({ label: "flushed while leaving the shoot" });
    clearHistory();
    await pushed;
    expect(historyState().entries).toEqual([]);
  });
});
