import { useVirtualizer } from "@tanstack/react-virtual";
import { Check } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { fileSrc, type ImageFile } from "@/lib/core";
import { useThumbnail } from "@/lib/queries";
import { useVirtualJump } from "@/lib/useVirtualJump";
import { ExposureBadge, RatingBadge } from "./PhotoBadges";
import { Skeleton } from "./ui/skeleton";

const TARGET_ROW_HEIGHT = 220;
const GAP = 8;

type Cell = { image: ImageFile; index: number; width: number };
type Row = { cells: Cell[]; height: number };

function packRows(images: ImageFile[], containerWidth: number): Row[] {
  const rows: Row[] = [];
  let current: { image: ImageFile; index: number; ratio: number }[] = [];
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
  flush(false);

  return rows;
}

function splitRel(rel: string): [string, string] {
  const cut = rel.lastIndexOf("/");
  return cut === -1 ? ["", rel] : [rel.slice(0, cut + 1), rel.slice(cut + 1)];
}

const LONG_PRESS_MS = 400;

function Thumb({
  image,
  width,
  height,
  showInfo,
  selected,
  current,
  selectMode,
  onOpen,
  onSelect,
}: {
  image: ImageFile;
  width: number;
  height: number;
  showInfo?: boolean;
  selected?: boolean;
  current?: boolean;
  selectMode?: boolean;
  onOpen?: () => void;
  onSelect?: (modifiers: { meta: boolean; shift: boolean }) => void;
}) {
  const thumb = useThumbnail(image);
  const pressTimer = useRef<number | null>(null);
  const pressFired = useRef(false);

  const cancelPress = () => {
    if (pressTimer.current !== null) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };
  useEffect(
    () => () => {
      if (pressTimer.current !== null) clearTimeout(pressTimer.current);
    },
    [],
  );

  const [dir, name] = splitRel(image.rel);

  return (
    <button
      type="button"
      data-testid="thumb"
      data-path={image.rel}
      data-selected={selected ? "true" : "false"}
      data-current={current ? "true" : "false"}
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
        selected
          ? "ring-2 ring-primary"
          : current
            ? "ring-2 ring-foreground"
            : ""
      }`}
      style={{ width, height }}
    >
      {thumb.data ? (
        <img
          src={fileSrc(thumb.data)}
          alt={image.rel}
          loading="lazy"
          className="h-full w-full object-cover"
        />
      ) : (
        <Skeleton className="h-full w-full rounded-none" />
      )}
      {selected && (
        <span className="absolute top-1.5 left-1.5 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="size-3" />
        </span>
      )}
      <ExposureBadge
        exposure={image.edit.exposure}
        unit=" EV"
        testid="thumb-edited"
        className="absolute top-1.5 right-1.5 rounded-full bg-background/70 px-1.5 py-0.5 font-mono text-[9px] text-foreground/80 backdrop-blur"
      />
      <span
        data-testid="thumb-info"
        className={`absolute inset-x-0 bottom-0 flex items-center gap-1 bg-background/70 px-2 py-1 font-mono text-[10px] text-foreground/80 transition-opacity ${
          showInfo
            ? "opacity-100"
            : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
        }`}
      >
        <span className="truncate">
          {dir && <span className="text-muted-foreground/70">{dir}</span>}
          {name}
        </span>
        <RatingBadge
          rating={image.rating}
          testid="thumb-rating"
          className="ml-auto shrink-0"
        />
      </span>
    </button>
  );
}

type Props = {
  images: ImageFile[];
  onOpen?: (index: number) => void;
  showInfo?: boolean;
  selected?: ReadonlySet<string>;
  selectMode?: boolean;
  onSelect?: (
    path: string,
    modifiers: { meta: boolean; shift: boolean },
  ) => void;
  focusPath?: string | null;
  initialRect?: { width: number; height: number };
};

export function ImageGrid({
  images,
  onOpen,
  showInfo,
  selected,
  selectMode,
  onSelect,
  focusPath,
  initialRect,
}: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const padding = 24;
  const [containerWidth, setContainerWidth] = useState(
    () => (initialRect?.width ?? 800) - padding * 2,
  );
  const [measured, setMeasured] = useState(initialRect != null);

  useEffect(() => {
    const element = parentRef.current;
    if (!element) return;
    const update = () => {
      const width = element.clientWidth - padding * 2;
      if (width > 0) {
        setContainerWidth(width);
        setMeasured(true);
      }
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

  const focusRow = useMemo(
    () =>
      focusPath
        ? rows.findIndex((row) =>
            row.cells.some((cell) => cell.image.path === focusPath),
          )
        : -1,
    [rows, focusPath],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: measure() on rows change is the point
  useEffect(() => {
    virtualizer.measure();
  }, [rows]);

  useVirtualJump(virtualizer, focusRow, measured);

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
              style={{
                transform: `translateY(${virtualRow.start}px)`,
                gap: GAP,
              }}
            >
              {row.cells.map((cell) => (
                <Thumb
                  key={cell.image.path}
                  image={cell.image}
                  width={cell.width}
                  height={row.height}
                  showInfo={showInfo}
                  selected={selected?.has(cell.image.path)}
                  current={cell.image.path === focusPath}
                  selectMode={selectMode}
                  onOpen={onOpen && (() => onOpen(cell.index))}
                  onSelect={
                    onSelect && ((mods) => onSelect(cell.image.path, mods))
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
