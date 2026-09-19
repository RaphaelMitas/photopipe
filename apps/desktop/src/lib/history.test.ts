import { Star } from "lucide-react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearHistory,
  historyState,
  jumpHistory,
  pushHistory,
  redoHistory,
  undoHistory,
} from "./history";

let value = 0;

function set(next: number) {
  const before = value;
  value = next;
  pushHistory({
    icon: Star,
    label: `set ${next}`,
    paths: ["a.arw"],
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
    expect(historyState().entries.map((entry) => entry.label)).toEqual([
      "set 1",
      "set 5",
    ]);
    expect(await redoHistory()).toBeNull();
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
    pushHistory({
      icon: Star,
      label: "fails",
      paths: [],
      undo: () => Promise.reject(new Error("disk")),
      redo: async () => {},
    });
    expect(await undoHistory()).toBeNull();
    expect(historyState().cursor).toBe(2);
  });
});
