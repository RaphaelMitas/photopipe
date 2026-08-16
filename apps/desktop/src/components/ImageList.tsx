import { useVirtualizer } from "@tanstack/react-virtual";
import { useMemo, useRef } from "react";
import { fileSrc, type ImageFile } from "@/lib/core";
import { useThumbnail } from "@/lib/queries";
import { useVirtualJump } from "@/lib/useVirtualJump";
import { cn } from "@/lib/utils";
import { ExposureBadge, RatingBadge } from "./PhotoBadges";
import { Skeleton } from "./ui/skeleton";

const ROW_HEIGHT = 44;

function RowThumb({ image }: { image: ImageFile }) {
  const thumb = useThumbnail(image);
  if (!thumb.data) return <Skeleton className="h-8 w-12 shrink-0 rounded-sm" />;
  return (
    <img
      src={fileSrc(thumb.data)}
      alt={image.rel}
      loading="lazy"
      className="h-8 w-12 shrink-0 rounded-sm object-cover"
    />
  );
}

type Props = {
  images: ImageFile[];
  selected: ReadonlySet<string>;
  selectMode: boolean;
  onSelect: (
    path: string,
    modifiers: { meta: boolean; shift: boolean },
  ) => void;
  onOpen?: (index: number) => void;
  emptyMessage: string;
  focusPath?: string | null;
  initialRect?: { width: number; height: number };
};

export function ImageList({
  images,
  selected,
  selectMode,
  onSelect,
  onOpen,
  emptyMessage,
  focusPath,
  initialRect,
}: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: images.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
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

  const focusIndex = useMemo(
    () =>
      focusPath ? images.findIndex((image) => image.path === focusPath) : -1,
    [images, focusPath],
  );

  useVirtualJump(virtualizer, focusIndex);

  if (images.length === 0) {
    return (
      <p data-testid="list-empty" className="p-8 text-sm text-muted-foreground">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-3 py-1.5 font-mono text-[10px] text-muted-foreground uppercase">
        <span className="w-12 shrink-0" />
        <span className="min-w-0 flex-1">Photo</span>
        <span className="w-24 shrink-0 text-right">Rating</span>
      </div>
      <div
        ref={parentRef}
        data-testid="image-table"
        className="min-h-0 flex-1 overflow-auto"
      >
        <div
          className="relative w-full"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const image = images[item.index];
            const isSelected = selected.has(image.path);
            const isCurrent = image.path === focusPath;
            return (
              <button
                key={item.key}
                type="button"
                data-testid="image-row"
                data-path={image.rel}
                data-selected={isSelected}
                data-current={isCurrent}
                onClick={(event) => {
                  const meta = event.metaKey || event.ctrlKey;
                  if (onOpen && !meta && !event.shiftKey && !selectMode) {
                    onOpen(item.index);
                    return;
                  }
                  onSelect(image.path, {
                    meta: meta || (!onOpen && !event.shiftKey) || selectMode,
                    shift: event.shiftKey,
                  });
                }}
                className={cn(
                  "absolute top-0 left-0 flex w-full items-center gap-3 px-3 text-left",
                  isSelected ? "bg-secondary" : "hover:bg-accent",
                  isCurrent && "ring-1 ring-foreground ring-inset",
                )}
                style={{
                  height: ROW_HEIGHT,
                  transform: `translateY(${item.start}px)`,
                }}
              >
                <RowThumb image={image} />
                <span className="min-w-0 flex-1 truncate font-mono text-xs">
                  {image.rel}
                </span>
                <span className="flex w-24 shrink-0 items-center justify-end gap-1.5 text-xs">
                  <ExposureBadge
                    exposure={image.edit.exposure}
                    className="font-mono text-[10px] text-muted-foreground"
                  />
                  <RatingBadge rating={image.rating} />
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
