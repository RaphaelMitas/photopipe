import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Flag } from "@/lib/core";
import { useRatingFilter } from "./RatingFilter";

const plain = { meta: false, shift: false };
const meta = { meta: true, shift: false };
const shift = { meta: false, shift: true };

const photos = [
  { rating: 0, flag: -1 },
  { rating: 0, flag: 0 },
  { rating: 2, flag: 1 },
  { rating: 4, flag: 0 },
  { rating: 5, flag: 1 },
] satisfies { rating: number; flag: Flag }[];

function shown(filter: ReturnType<typeof useRatingFilter>) {
  return photos.filter(filter.matches);
}

describe("useRatingFilter", () => {
  it("narrows stars by flags and widens within each kind", () => {
    const { result } = renderHook(() => useRatingFilter());
    act(() => result.current.clickStars(4, plain));
    expect(shown(result.current)).toEqual([photos[3], photos[4]]);

    act(() => result.current.clickFlag(1, meta));
    expect(shown(result.current)).toEqual([photos[4]]);

    act(() => result.current.clickFlag(-1, meta));
    act(() => result.current.clickStars(0, meta));
    expect(shown(result.current)).toEqual([photos[0], photos[4]]);
  });

  it("a plain click on a flag bar shows only that flag, and again clears it", () => {
    const { result } = renderHook(() => useRatingFilter());
    act(() => result.current.clickStars(2, plain));
    act(() => result.current.clickFlag(-1, plain));
    expect(shown(result.current)).toEqual([photos[0]]);
    act(() => result.current.clickFlag(-1, plain));
    expect(result.current.active).toBe(false);
  });

  it("shift adds to a flag instead of replacing it when no star was clicked yet", () => {
    const { result } = renderHook(() => useRatingFilter());
    act(() => result.current.clickFlag(1, plain));
    act(() => result.current.clickStars(5, shift));
    expect(shown(result.current)).toEqual([photos[4]]);
  });

  it("a comparator does not bring back a filter that was cleared", () => {
    const { result } = renderHook(() => useRatingFilter());
    act(() => result.current.clickStars(3, plain));
    act(() => result.current.clickStars(3, plain));
    act(() => result.current.setOp("eq"));
    expect(result.current.active).toBe(false);
  });

  it("shift spans from the last clicked bar", () => {
    const { result } = renderHook(() => useRatingFilter());
    act(() => result.current.setOp("eq"));
    act(() => result.current.clickStars(0, plain));
    act(() => result.current.clickStars(2, shift));
    expect(shown(result.current)).toEqual(photos.slice(0, 3));
  });
});
