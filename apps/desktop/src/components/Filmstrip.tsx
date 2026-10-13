import { useVirtualizer } from "@tanstack/react-virtual";
import { Star } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import type { ImageFile } from "@/lib/core";
import { pref } from "@/lib/pref";
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

type Props = {
  images: ImageFile[];
  index: number;
  mode: Exclude<FilmstripMode, "off">;
  onNavigate: (index: number) => void;
};

export function Filmstrip({ images, index, mode, onNavigate }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const widths = useMemo(() => {
    if (mode === "ratings") return images.map(() => FIXED_CELL_WIDTH);
    return images.map((image) =>
      Math.max(28, Math.round(STRIP_HEIGHT * aspectRatio(image))),
    );
  }, [images, mode]);

  const virtualizer = useVirtualizer({
    horizontal: true,
    count: images.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => widths[i] + GAP,
    overscan: 12,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: recenter on navigation, re-measure on mode change
  useEffect(() => {
    virtualizer.measure();
    virtualizer.scrollToIndex(index, { align: "center" });
  }, [index, mode]);

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
          const active = item.index === index;
          return (
            <button
              key={item.key}
              type="button"
              data-path={image.rel}
              onClick={() => onNavigate(item.index)}
              className={`absolute top-0 left-0 flex h-full flex-col overflow-hidden rounded-sm transition-opacity ${
                active
                  ? "ring-2 ring-primary opacity-100"
                  : "opacity-60 hover:opacity-100"
              }`}
              style={{
                transform: `translateX(${item.start}px)`,
                width: widths[item.index],
              }}
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
          );
        })}
      </div>
    </div>
  );
}
