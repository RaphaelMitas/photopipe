import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useSelection } from "./selection";

const STEMS = ["A", "B", "C", "D", "E"];

describe("useSelection", () => {
  it("selects, toggles with meta, and extends with shift", () => {
    const { result } = renderHook(() => useSelection(STEMS));

    act(() => result.current.click("B", {}));
    expect([...result.current.selected]).toEqual(["B"]);

    // ⌘-click adds without clearing.
    act(() => result.current.click("D", { meta: true }));
    expect([...result.current.selected].sort()).toEqual(["B", "D"]);

    // ⌘-click again removes.
    act(() => result.current.click("B", { meta: true }));
    expect([...result.current.selected]).toEqual(["D"]);

    // Shift extends from the last plain click — the anchor.
    act(() => result.current.click("B", {}));
    act(() => result.current.click("E", { shift: true }));
    expect([...result.current.selected].sort()).toEqual(["B", "C", "D", "E"]);
  });

  it("extends backwards too", () => {
    const { result } = renderHook(() => useSelection(STEMS));
    act(() => result.current.click("D", {}));
    act(() => result.current.click("B", { shift: true }));
    expect([...result.current.selected].sort()).toEqual(["B", "C", "D"]);
  });

  it("a plain click on the lone selected item clears it", () => {
    const { result } = renderHook(() => useSelection(STEMS));
    act(() => result.current.click("C", {}));
    act(() => result.current.click("C", {}));
    expect(result.current.isEmpty).toBe(true);
  });

  it("selects all and clears", () => {
    const { result } = renderHook(() => useSelection(STEMS));
    act(() => result.current.selectAll());
    expect(result.current.selected.size).toBe(5);
    act(() => result.current.clear());
    expect(result.current.isEmpty).toBe(true);
  });

  it("drops stems that disappear, so actions never touch invisible images", () => {
    const { result, rerender } = renderHook(({ list }) => useSelection(list), {
      initialProps: { list: STEMS },
    });
    act(() => result.current.selectAll());
    expect(result.current.selected.size).toBe(5);

    // C and E were deleted (or filtered away).
    rerender({ list: ["A", "B", "D"] });
    expect([...result.current.selected].sort()).toEqual(["A", "B", "D"]);
  });
});
