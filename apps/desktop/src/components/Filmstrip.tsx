import { useVirtualizer } from "@tanstack/react-virtual";
import { Star } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import type { ImageFile } from "@/lib/core";
import { pref } from "@/lib/pref";
import type { Stack } from "@/lib/stacks";
import { aspectRatio, Thumbnail } from "./Thumbnail";

export type FilmstripMode = "off" | "thumbs" | "ratings";

export const filmstripPref = pref(
  "photopipe.filmstrip",
  (raw): FilmstripMode => {
    if (raw === "0") return "off";
    if (raw === "off" || raw === "thumbs" || raw === "ratings") return raw;
    return "thumbs";
  },
  String,
);

const STRIP_HEIGHT = 64;
const GAP = 4;
const FIXED_CELL_WIDTH = 56;
const FIXED_THUMB_HEIGHT = 56;
const RATING_ROW_HEIGHT = 16;
const STACK_GAP = 12;

type Props = {
  images: ImageFile[];
  index: number;
  mode: Exclude<FilmstripMode, "off">;
  stacks: { list: Stack[]; current: Stack; inside: boolean } | null;
  onNavigate: (index: number) => void;
};

type Place = { stack: Stack; first: boolean; last: boolean };

export function Filmstrip({ images, index, mode, stacks, onNavigate }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const widths = useMemo(() => {
    if (mode === "ratings") return images.map(() => FIXED_CELL_WIDTH);
    return images.map((image) =>
      Math.max(28, Math.round(STRIP_HEIGHT * aspectRatio(image))),
    );
  }, [images, mode]);

  const list = stacks?.list;
  const places = useMemo(() => {
    if (!list) return null;
    const byPath = new Map<string, Place>();
    for (const stack of list) {
      stack.frames.forEach((frame, i) => {
        byPath.set(frame.path, {
          stack,
          first: i === 0,
          last: i === stack.frames.length - 1,
        });
      });
    }
    return images.map((image) => byPath.get(image.path));
  }, [images, list]);

  const virtualizer = useVirtualizer({
    horizontal: true,
    count: images.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => widths[i] + GAP + (places?.[i]?.last ? STACK_GAP : 0),
    overscan: 12,
  });

  // every rating rebuilds the stacks, so the grouping is compared by shape, not identity
  const grouping = list?.map((stack) => stack.frames.length).join() ?? "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: recenter on navigation, re-measure on mode or grouping change
  useEffect(() => {
    virtualizer.measure();
    virtualizer.scrollToIndex(index, { align: "center" });
  }, [index, mode, grouping]);

  const cellHeight =
    mode === "ratings" ? FIXED_THUMB_HEIGHT + RATING_ROW_HEIGHT : STRIP_HEIGHT;

  return (
    <div
      ref={parentRef}
      data-testid="filmstrip"
      data-mode={mode}
      className="shrink-0 overflow-x-auto border-t border-border bg-background/80 px-2 py-2"
    >
      <div
        className="relative"
        style={{ width: virtualizer.getTotalSize(), height: cellHeight }}
      >
        {virtualizer.getVirtualItems().map((item) => {
          const image = images[item.index];
          const place = places?.[item.index];
          const mine = place !== undefined && place.stack === stacks?.current;
          const wholeStackActive =
            mine && !stacks?.inside && place.stack.frames.length > 1;
          const active = item.index === index && !wholeStackActive;
          const faded = stacks?.inside && !mine;
          return (
            <div
              key={item.key}
              className="absolute top-0 left-0 h-full"
              style={{
                transform: `translateX(${item.start}px)`,
                width: widths[item.index],
              }}
            >
              {place && place.stack.frames.length > 1 && (
                <span
                  data-testid={
                    wholeStackActive ? "filmstrip-stack-current" : undefined
                  }
                  className={`pointer-events-none absolute -inset-y-1 border-y ${
                    place.first ? "-left-1 rounded-l-md border-l" : "left-0"
                  } ${place.last ? "-right-1 rounded-r-md border-r" : ""} ${
                    wholeStackActive
                      ? "border-primary bg-primary/10"
                      : "border-foreground/20"
                  } ${faded ? "opacity-30" : ""}`}
                  style={place.last ? undefined : { right: -GAP }}
                />
              )}
              <button
                type="button"
                data-path={image.rel}
                onClick={() => onNavigate(item.index)}
                className={`relative flex h-full w-full flex-col overflow-hidden rounded-sm transition-opacity ${
                  active
                    ? "ring-2 ring-primary opacity-100"
                    : wholeStackActive
                      ? "opacity-100"
                      : faded
                        ? "opacity-25 hover:opacity-60"
                        : "opacity-60 hover:opacity-100"
                }`}
              >
                <Thumbnail file={image} className="min-h-0 w-full flex-1" />
                {mode === "ratings" && (
                  <span
                    data-testid="filmstrip-rating"
                    className="flex w-full items-center justify-center gap-0.5 bg-background/90 font-mono text-[10px] text-amber-400"
                    style={{ height: RATING_ROW_HEIGHT }}
                  >
                    {image.rating > 0 ? (
                      <>
                        <Star className="size-2.5 fill-amber-400" />
                        {image.rating}
                      </>
                    ) : (
                      <span className="text-muted-foreground/40">·</span>
                    )}
                  </span>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
