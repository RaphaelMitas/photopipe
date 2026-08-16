import { Skeleton } from "@photopipe/ui/components/skeleton";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Star } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { fileSrc, type ImageFile } from "@/lib/core";
import { useThumbnail } from "@/lib/queries";

export type FilmstripMode = "off" | "thumbs" | "ratings";

const STRIP_HEIGHT = 64;
const GAP = 4;
const FIXED_CELL_WIDTH = 56;
const FIXED_THUMB_HEIGHT = 56;
const RATING_ROW_HEIGHT = 16;

function Thumb({
  image,
  className,
  style,
}: {
  image: ImageFile;
  className: string;
  style?: React.CSSProperties;
}) {
  const thumb = useThumbnail(image);
  if (!thumb.data) {
    return <Skeleton className={`${className} rounded-none`} style={style} />;
  }
  return (
    <img
      src={fileSrc(thumb.data)}
      alt={image.rel}
      loading="lazy"
      className={`${className} object-cover`}
      style={style}
    />
  );
}

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
    return images.map((image) => {
      const ratio =
        image.width > 0 && image.height > 0 ? image.width / image.height : 1.5;
      return Math.max(28, Math.round(STRIP_HEIGHT * ratio));
    });
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
      style={{ height: cellHeight + 16 }}
    >
      <div
        className="relative h-full"
        style={{ width: virtualizer.getTotalSize() }}
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
              <Thumb
                image={image}
                className={
                  mode === "ratings" ? "w-full shrink-0" : "h-full w-full"
                }
                style={
                  mode === "ratings"
                    ? { height: FIXED_THUMB_HEIGHT }
                    : undefined
                }
              />
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
