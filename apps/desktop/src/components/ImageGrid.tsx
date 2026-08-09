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

/// Hold this long to start selecting instead of opening the photo.
const LONG_PRESS_MS = 400;

function Thumb({
  image,
  width,
  height,
  showInfo,
  selected,
  selectMode,
  displayOriginal,
  onOpen,
  onSelect,
}: {
  image: ImageGroup;
  width: number;
  height: number;
  showInfo?: boolean;
  selected?: boolean;
  selectMode?: boolean;
  displayOriginal?: boolean;
  onOpen?: () => void;
  onSelect?: (modifiers: { meta: boolean; shift: boolean }) => void;
}) {
  // Files are rank-sorted: first is the original capture, last the export.
  const display = displayOriginal
    ? image.files[0]
    : image.files[image.files.length - 1];
  const thumb = useThumbnail(display);
  const pressTimer = useRef<number | null>(null);
  // A long press already acted; the click that follows must not also open
  // the loupe.
  const pressFired = useRef(false);

  const cancelPress = () => {
    if (pressTimer.current !== null) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };
  // Unmounting mid-press must not fire a selection afterwards. Reads the ref
  // directly so it needs no dependency on the (per-render) helper above.
  useEffect(
    () => () => {
      if (pressTimer.current !== null) clearTimeout(pressTimer.current);
    },
    [],
  );

  return (
    <button
      type="button"
      data-testid="thumb"
      data-stem={image.stem}
      data-selected={selected ? "true" : "false"}
      onPointerDown={() => {
        pressFired.current = false;
        cancelPress();
        pressTimer.current = window.setTimeout(() => {
          pressFired.current = true;
          onSelect?.({ meta: true, shift: false });
        }, LONG_PRESS_MS);
      }}
      onPointerUp={cancelPress}
      onPointerLeave={cancelPress}
      onPointerCancel={cancelPress}
      // A plain click opens the photo — that's the common case. Selecting is
      // deliberate: hold, or use ⌘/shift. Once anything is selected you're in
      // select mode, and plain clicks toggle until you clear it.
      onClick={(event) => {
        if (pressFired.current) {
          pressFired.current = false;
          return;
        }
        const meta = event.metaKey || event.ctrlKey;
        if (meta || event.shiftKey) {
          onSelect?.({ meta, shift: event.shiftKey });
        } else if (selectMode) {
          onSelect?.({ meta: true, shift: false });
        } else {
          onOpen?.();
        }
      }}
      className={`group relative shrink-0 overflow-hidden rounded-md bg-card transition-shadow focus-visible:ring-2 focus-visible:ring-ring hover:shadow-lg ${
        selected ? "ring-2 ring-primary" : ""
      }`}
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
      <span
        data-testid="thumb-info"
        className={`absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-background/70 px-2 py-1 font-mono text-[10px] text-foreground/80 transition-opacity ${
          showInfo
            ? "opacity-100"
            : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
        }`}
      >
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
  /// Called with the image's index in `images` when a thumb is clicked
  /// outside select mode.
  onOpen?: (index: number) => void;
  /// Overlay always visible instead of hover-only.
  showInfo?: boolean;
  selected?: ReadonlySet<string>;
  /// Anything selected means select mode: plain clicks toggle rather than
  /// opening the photo.
  selectMode?: boolean;
  /// Show the original capture instead of the furthest-stage file — the
  /// Media page is about what you shot, not what you exported.
  displayOriginal?: boolean;
  onSelect?: (
    stem: string,
    modifiers: { meta: boolean; shift: boolean },
  ) => void;
  /// Test hook: jsdom has no layout, so tests inject the viewport.
  initialRect?: { width: number; height: number };
};

export function ImageGrid({
  images,
  onOpen,
  showInfo,
  selected,
  selectMode,
  displayOriginal,
  onSelect,
  initialRect,
}: Props) {
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
                  showInfo={showInfo}
                  selected={selected?.has(cell.image.stem)}
                  selectMode={selectMode}
                  displayOriginal={displayOriginal}
                  onOpen={onOpen && (() => onOpen(cell.index))}
                  onSelect={
                    onSelect && ((mods) => onSelect(cell.image.stem, mods))
                  }
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
