import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDebouncedExposure } from "./useDebouncedExposure";

afterEach(cleanup);

describe("useDebouncedExposure", () => {
  it("commits once at rest, not on every scrub tick", () => {
    vi.useFakeTimers();
    const commit = vi.fn();
    // Reproduce the real App wiring: `commit` is a fresh closure every render
    // (it wraps a react-query mutation object that changes identity), which is
    // exactly what defeated a naive unmount effect.
    const { result, rerender } = renderHook(() =>
      useDebouncedExposure((path, value) => commit(path, value), 400),
    );

    for (const value of [0, 1, 2, 3, 4]) {
      act(() => result.current.scrub("/r/a.arw", value));
      rerender();
    }
    expect(commit).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(400));
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith("/r/a.arw", 4);
    vi.useRealTimers();
  });

  it("commits the previous photo when scrubbing a different one", () => {
    vi.useFakeTimers();
    const commit = vi.fn();
    const { result } = renderHook(() => useDebouncedExposure(commit, 400));

    act(() => result.current.scrub("/r/a.arw", 1));
    act(() => result.current.scrub("/r/b.arw", 2));
    // A's pending edit must not be dropped by B's scrub.
    expect(commit).toHaveBeenCalledWith("/r/a.arw", 1);

    act(() => vi.advanceTimersByTime(400));
    expect(commit).toHaveBeenCalledWith("/r/b.arw", 2);
    expect(commit).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("flushes the pending edit on unmount", () => {
    vi.useFakeTimers();
    const commit = vi.fn();
    const { result, unmount } = renderHook(() =>
      useDebouncedExposure(commit, 400),
    );

    act(() => result.current.scrub("/r/a.arw", 3));
    unmount();
    expect(commit).toHaveBeenCalledExactlyOnceWith("/r/a.arw", 3);
    vi.useRealTimers();
  });
});
