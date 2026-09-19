import { Star } from "lucide-react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearHistory,
  forgetHistoryPaths,
  historyEpoch,
  historyState,
  jumpHistory,
  pushHistory,
  redoHistory,
  undoHistory,
} from "./history";

let value = 0;

function set(next: number, path = "a.arw") {
  const before = value;
  value = next;
  void pushHistory({
    icon: Star,
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

describe("history", () => {
  beforeEach(() => {
    clearHistory();
    value = 0;
  });

  it("walks back and forward through what was done", async () => {
    set(1);
    set(2);
    await undoHistory();
    expect(value).toBe(1);
    await redoHistory();
    expect(value).toBe(2);
    expect(await redoHistory()).toBeNull();
  });

  it("runs quick presses one after the other", async () => {
    set(1);
    set(2);
    set(3);
    await Promise.all([undoHistory(), undoHistory(), undoHistory()]);
    expect(value).toBe(0);
    expect(historyState().cursor).toBe(0);
  });

  it("drops the undone entries when something new happens", async () => {
    set(1);
    set(2);
    await undoHistory();
    set(5);
    await redoHistory();
    expect(historyState().entries.map((entry) => entry.label)).toEqual([
      "set 1",
      "set 5",
    ]);
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

  it("stays put when the write behind a step fails", async () => {
    set(1);
    void pushHistory({
      icon: Star,
      label: "fails",
      paths: [],
      undo: () => Promise.reject(new Error("disk")),
      redo: async () => {},
    });
    expect(await undoHistory()).toBeNull();
    expect(historyState().cursor).toBe(2);
  });

  it("keeps an action taken during an undo applied", async () => {
    let finishUndo = () => {};
    void pushHistory({
      icon: Star,
      label: "slow",
      paths: [],
      undo: () =>
        new Promise<void>((resolve) => {
          finishUndo = resolve;
        }),
      redo: async () => {},
    });
    const undone = undoHistory();
    await new Promise((resolve) => setTimeout(resolve));
    set(7);
    finishUndo();
    await undone;
    await jumpHistory(1);
    expect(historyState().entries.map((entry) => entry.label)).toEqual([
      "set 7",
    ]);
    expect(historyState().cursor).toBe(1);
  });

  it("forgets trashed photos so they cannot block what is under them", async () => {
    set(1, "kept.arw");
    set(2, "trashed.arw");
    set(3, "kept.arw");
    await forgetHistoryPaths(["trashed.arw"]);
    expect(historyState().entries.map((entry) => entry.label)).toEqual([
      "set 1",
      "set 3",
    ]);
    expect(historyState().cursor).toBe(2);
  });

  it("refuses an action that finishes after the timeline was cleared", async () => {
    const since = historyEpoch();
    clearHistory();
    await pushHistory(
      {
        icon: Star,
        label: "late paste",
        paths: [],
        undo: async () => {},
        redo: async () => {},
      },
      since,
    );
    expect(historyState().entries).toEqual([]);
  });
});
