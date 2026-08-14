import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Edit, identityEdit } from "./core";
import { useDebouncedEdit } from "./useDebouncedEdit";

afterEach(cleanup);

const editWith = (exposure: number): Edit => ({ ...identityEdit, exposure });

describe("useDebouncedEdit", () => {
  it("commits once at rest, not on every scrub tick", () => {
    vi.useFakeTimers();
    const commit = vi.fn();
    // Reproduce the real App wiring: `commit` is a fresh closure every render
    // (it wraps a react-query mutation object that changes identity), which is
    // exactly what defeated a naive unmount effect.
    const { result, rerender } = renderHook(() =>
      useDebouncedEdit((path, edit) => commit(path, edit), 400),
    );

    for (const exposure of [0, 1, 2, 3, 4]) {
      act(() => result.current.scrub("/r/a.arw", editWith(exposure)));
      rerender();
    }
    expect(commit).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(400));
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith("/r/a.arw", editWith(4));
    vi.useRealTimers();
  });

  it("commits the previous photo when scrubbing a different one", () => {
    vi.useFakeTimers();
    const commit = vi.fn();
    const { result } = renderHook(() => useDebouncedEdit(commit, 400));

    act(() => result.current.scrub("/r/a.arw", editWith(1)));
    act(() => result.current.scrub("/r/b.arw", editWith(2)));
    // A's pending edit must not be dropped by B's scrub.
    expect(commit).toHaveBeenCalledWith("/r/a.arw", editWith(1));

    act(() => vi.advanceTimersByTime(400));
    expect(commit).toHaveBeenCalledWith("/r/b.arw", editWith(2));
    expect(commit).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("flushes the pending edit on unmount", () => {
    vi.useFakeTimers();
    const commit = vi.fn();
    const { result, unmount } = renderHook(() => useDebouncedEdit(commit, 400));

    act(() => result.current.scrub("/r/a.arw", editWith(3)));
    unmount();
    expect(commit).toHaveBeenCalledExactlyOnceWith("/r/a.arw", editWith(3));
    vi.useRealTimers();
  });
});
