import { useVirtualizer } from "@tanstack/react-virtual";
import { Star } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { fileSrc, type ImageGroup, type Stage } from "@/lib/core";
import { useThumbnail } from "@/lib/queries";
import { Skeleton } from "./ui/skeleton";

const TARGET_ROW_HEIGHT = 220;
const GAP = 8;

const STAGE_DOT: Record<Stage, string> = {
  raw: "bg-muted-foreground",
  denoised: "bg-sky-400",
  export: "bg-emerald-400",
};

type Cell = { image: ImageGroup; index: number; width: number };
type Row = { cells: Cell[]; height: number };

/// Justified layout: fill each row greedily at the target height, then scale
/// the row so it exactly spans the container. Verticals keep their full
/// aspect — nothing is cropped.
function packRows(images: ImageGroup[], containerWidth: number): Row[] {
  const rows: Row[] = [];
  let current: { image: ImageGroup; index: number; ratio: number }[] = [];
  let ratioSum = 0;

  const flush = (justify: boolean) => {
    if (current.length === 0) return;
    const gaps = GAP * (current.length - 1);
    const height = justify
      ? (containerWidth - gaps) / ratioSum
      : TARGET_ROW_HEIGHT;
    rows.push({
      cells: current.map((entry) => ({
        image: entry.image,
        index: entry.index,
        width: entry.ratio * height,
      })),
      height,
    });
    current = [];
    ratioSum = 0;
  };

  images.forEach((image, index) => {
    const ratio =
      image.width > 0 && image.height > 0 ? image.width / image.height : 1.5;
    current.push({ image, index, ratio });
    ratioSum += ratio;
    const naturalWidth =
      ratioSum * TARGET_ROW_HEIGHT + GAP * (current.length - 1);
    if (naturalWidth >= containerWidth) flush(true);
  });
  flush(false); // trailing partial row stays at target height, left-aligned

  return rows;
}

function Thumb({
  image,
  width,
  height,
  onOpen,
}: {
  image: ImageGroup;
  width: number;
  height: number;
  onOpen?: () => void;
}) {
  const display = image.files[image.files.length - 1];
  const thumb = useThumbnail(display);
  return (
    <button
      type="button"
      data-testid="thumb"
      data-stem={image.stem}
      onClick={onOpen}
      className="group relative shrink-0 overflow-hidden rounded-md bg-card transition-shadow focus-visible:ring-2 focus-visible:ring-ring hover:shadow-lg"
      style={{ width, height }}
    >
      {thumb.data ? (
        <img
          src={fileSrc(thumb.data)}
          alt={image.stem}
          loading="lazy"
          className="h-full w-full object-cover"
        />
      ) : (
        <Skeleton className="h-full w-full rounded-none" />
      )}
      <span className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-background/70 px-2 py-1 font-mono text-[10px] text-foreground/80 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        <span
          className={`h-1.5 w-1.5 rounded-full ${STAGE_DOT[image.stage]}`}
        />
        <span className="truncate">{image.stem}</span>
        {image.rating > 0 && (
          <span
            data-testid="thumb-rating"
            className="ml-auto flex shrink-0 items-center gap-0.5 text-amber-400"
          >
            <Star className="size-3 fill-amber-400" />
            {image.rating}
          </span>
        )}
      </span>
    </button>
  );
}

type Props = {
  images: ImageGroup[];
  /// Called with the image's index in `images` when a thumb is clicked.
  onOpen?: (index: number) => void;
  /// Test hook: jsdom has no layout, so tests inject the viewport.
  initialRect?: { width: number; height: number };
};

export function ImageGrid({ images, onOpen, initialRect }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const padding = 24; // p-6 on each side
  const [containerWidth, setContainerWidth] = useState(
    () => (initialRect?.width ?? 800) - padding * 2,
  );

  useEffect(() => {
    const element = parentRef.current;
    if (!element) return;
    const update = () => {
      const width = element.clientWidth - padding * 2;
      if (width > 0) setContainerWidth(width);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const rows = useMemo(
    () => packRows(images, containerWidth),
    [images, containerWidth],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => rows[index].height + GAP,
    overscan: 4,
    initialRect,
    // With an injected rect (tests: jsdom measures everything 0×0), trust it
    // instead of observing the real element.
    ...(initialRect && {
      observeElementRect: (
        _instance: unknown,
        cb: (rect: { width: number; height: number }) => void,
      ) => {
        cb(initialRect);
        return () => {};
      },
    }),
  });

  // Row heights depend on the packing; re-measure when it changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: measure() on rows change is the point
  useEffect(() => {
    virtualizer.measure();
  }, [rows]);

  return (
    <div
      ref={parentRef}
      data-testid="grid"
      className="h-full overflow-auto p-6"
    >
      <div
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index];
          return (
            <div
              key={virtualRow.key}
              className="absolute top-0 left-0 flex"
              // translateY for the same WKWebView repaint reason as the
              // filmstrip's translateX.
              style={{
                transform: `translateY(${virtualRow.start}px)`,
                gap: GAP,
              }}
            >
              {row.cells.map((cell) => (
                <Thumb
                  key={cell.image.stem}
                  image={cell.image}
                  width={cell.width}
                  height={row.height}
                  onOpen={onOpen && (() => onOpen(cell.index))}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
