import { Star } from "lucide-react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearHistory,
  forgetHistoryPaths,
  type HistoryAction,
  historyState,
  jumpHistory,
  pushHistory,
  stepHistory,
} from "./history";

let value = 0;

const push = (action: Partial<HistoryAction>) =>
  pushHistory({
    icon: Star,
    label: "step",
    paths: [],
    undo: async () => {},
    redo: async () => {},
    ...action,
  });

function set(next: number, path = "a.arw") {
  const before = value;
  value = next;
  void push({
    label: `set ${next}`,
    paths: [path],
    undo: async () => {
      value = before;
    },
    redo: async () => {
      value = next;
    },
  });
}

const labels = () => historyState().entries.map((entry) => entry.label);

describe("history", () => {
  beforeEach(() => {
    clearHistory();
    value = 0;
  });

  it("walks back and forward through what was done", async () => {
    set(1);
    set(2);
    await stepHistory("undo");
    expect(value).toBe(1);
    await stepHistory("redo");
    expect(value).toBe(2);
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
    expect(value).toBe(0);
    expect(historyState().cursor).toBe(0);
  });

  it("drops the undone entries when something new happens", async () => {
    set(1);
    set(2);
    await stepHistory("undo");
    set(5);
    await stepHistory("redo");
    expect(labels()).toEqual(["set 1", "set 5"]);
  });

  it("jumps across several entries in order", async () => {
    set(1);
    set(2);
    set(3);
    await jumpHistory(1);
    expect(value).toBe(1);
    await jumpHistory(3);
    expect(value).toBe(3);
  });

  it("drops a step that cannot run so it does not block the ones under it", async () => {
    set(1);
    void push({
      label: "fails",
      undo: () => Promise.reject(new Error("disk")),
    });
    expect(await stepHistory("undo")).toBeNull();
    await stepHistory("undo");
    expect(value).toBe(0);
    expect(labels()).toEqual(["set 1"]);
  });

  it("drops an entry whose own write failed", async () => {
    set(1);
    await push({
      label: "never landed",
      written: Promise.reject(new Error("disk")),
    });
    await jumpHistory(1);
    expect(labels()).toEqual(["set 1"]);
    expect(historyState().cursor).toBe(1);
  });

  it("cancels the undos still waiting once you act again", async () => {
    set(1);
    set(2);
    set(3);
    const first = stepHistory("undo");
    const second = stepHistory("undo");
    set(5);
    await Promise.all([first, second]);
    await jumpHistory(historyState().cursor);
    expect(value).toBe(5);
    expect(labels()).toEqual(["set 1", "set 2", "set 3", "set 5"]);
  });

  it("keeps an action taken during an undo applied", async () => {
    let finishUndo = () => {};
    void push({
      label: "slow",
      undo: () =>
        new Promise<void>((resolve) => {
          finishUndo = resolve;
        }),
    });
    const undone = stepHistory("undo");
    await new Promise((resolve) => setTimeout(resolve));
    set(7);
    finishUndo();
    await undone;
    await jumpHistory(1);
    expect(labels()).toEqual(["set 7"]);
    expect(historyState().cursor).toBe(1);
  });

  it("calls off an undo that was still waiting for the entry's own write", async () => {
    let finishWrite = () => {};
    let undone = false;
    await push({
      label: "long paste",
      undo: async () => {
        undone = true;
      },
      written: new Promise<void>((resolve) => {
        finishWrite = resolve;
      }),
    });
    const step = stepHistory("undo");
    await new Promise((resolve) => setTimeout(resolve));
    set(9);
    finishWrite();
    expect(await step).toBeNull();
    expect(undone).toBe(false);
    expect(value).toBe(9);
  });

  it("forgets trashed photos so they cannot block what is under them", async () => {
    set(1, "kept.arw");
    set(2, "trashed.arw");
    set(3, "kept.arw");
    await forgetHistoryPaths(["trashed.arw"]);
    expect(labels()).toEqual(["set 1", "set 3"]);
    expect(historyState().cursor).toBe(2);
  });

  it("refuses an action whose push lands after the timeline was cleared", async () => {
    const pushed = push({
      label: "flushed while leaving the shoot",
    });
    clearHistory();
    await pushed;
    expect(historyState().entries).toEqual([]);
  });

  it("keeps the photos that are left when part of a batch is trashed", async () => {
    const undone: string[][] = [];
    await push({
      label: "paste",
      paths: ["a.arw", "b.arw"],
      undo: async (paths) => {
        undone.push(paths);
      },
    });
    await forgetHistoryPaths(["a.arw"]);
    await stepHistory("undo");
    expect(undone).toEqual([["b.arw"]]);
  });
});
