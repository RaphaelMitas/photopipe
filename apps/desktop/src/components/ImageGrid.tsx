import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef, useState } from "react";
import { fileSrc, type ImageGroup, type Stage } from "@/lib/core";
import { useThumbnail } from "@/lib/queries";

const CELL = 168;
const GAP = 8;

const STAGE_DOT: Record<Stage, string> = {
  raw: "bg-muted-foreground",
  denoised: "bg-sky-400",
  export: "bg-emerald-400",
};

function Thumb({ image, onOpen }: { image: ImageGroup; onOpen?: () => void }) {
  const display = image.files[image.files.length - 1];
  const thumb = useThumbnail(display);
  return (
    <button
      type="button"
      data-testid="thumb"
      data-stem={image.stem}
      onClick={onOpen}
      className="relative overflow-hidden rounded-lg border border-border bg-card text-left transition-colors hover:border-ring"
      style={{ width: CELL, height: CELL }}
    >
      {thumb.data ? (
        <img
          src={fileSrc(thumb.data)}
          alt={image.stem}
          loading="lazy"
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="h-full w-full animate-pulse bg-card" />
      )}
      <span className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-background/70 px-2 py-1 font-mono text-[10px] text-foreground/80">
        <span
          className={`h-1.5 w-1.5 rounded-full ${STAGE_DOT[image.stage]}`}
        />
        <span className="truncate">{image.stem}</span>
        {image.rating > 0 && (
          <span
            data-testid="thumb-rating"
            className="ml-auto shrink-0 text-amber-400"
          >
            ★{image.rating}
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
  const [columns, setColumns] = useState(() =>
    Math.max(1, Math.floor((initialRect?.width ?? 800) / (CELL + GAP))),
  );

  useEffect(() => {
    const element = parentRef.current;
    if (!element) return;
    const update = () =>
      setColumns(
        Math.max(1, Math.floor(element.clientWidth / (CELL + GAP))) || 1,
      );
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const rowCount = Math.ceil(images.length / columns);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => CELL + GAP,
    overscan: 3,
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
        {virtualizer.getVirtualItems().map((row) => (
          <div
            key={row.key}
            className="absolute left-0 flex gap-2"
            style={{ top: row.start }}
          >
            {images
              .slice(row.index * columns, (row.index + 1) * columns)
              .map((image, column) => (
                <Thumb
                  key={image.stem}
                  image={image}
                  onOpen={
                    onOpen && (() => onOpen(row.index * columns + column))
                  }
                />
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}
