import { cn } from "@photopipe/ui/lib/utils";
import { type Rect, useVirtualizer } from "@tanstack/react-virtual";
import { useMemo, useRef } from "react";
import type { ImageFile } from "@/lib/core";
import { fNumber, focalMm, shutterText, takenTime } from "@/lib/exif";
import { fixedRect } from "@/lib/fixedRect";
import { clickIntent, type SelectModifiers } from "@/lib/selection";
import { useVirtualJump } from "@/lib/useVirtualJump";
import {
  ExposureBadge,
  PickMark,
  RatingBadge,
  rejectedFade,
} from "./PhotoBadges";
import { Thumbnail } from "./Thumbnail";

const ROW_HEIGHT = 44;

type Column = {
  label: string;
  className: string;
  value: (image: ImageFile) => string | number | null | undefined;
};

const COLUMNS: Column[] = [
  {
    label: "Taken",
    className: "w-24 text-left text-muted-foreground",
    value: (image) => image.captured && takenTime(image.captured),
  },
  {
    label: "Shutter",
    className: "w-14",
    value: (image) => image.exif.shutter && shutterText(image.exif.shutter),
  },
  {
    label: "f",
    className: "w-10",
    value: (image) => image.exif.aperture && fNumber(image.exif.aperture),
  },
  { label: "ISO", className: "w-12", value: (image) => image.exif.iso },
  {
    label: "mm",
    className: "w-10",
    value: (image) => image.exif.focal && focalMm(image.exif.focal),
  },
];

type Props = {
  images: ImageFile[];
  selected: ReadonlySet<string>;
  onSelect: (path: string, modifiers: SelectModifiers) => void;
  onOpen?: (index: number) => void;
  focusPath?: string | null;
  revealed?: number;
  initialRect?: Rect;
};

export function ImageList({
  images,
  selected,
  onSelect,
  onOpen,
  focusPath,
  revealed,
  initialRect,
}: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: images.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    ...fixedRect(initialRect),
  });

  const focusIndex = useMemo(
    () =>
      focusPath ? images.findIndex((image) => image.path === focusPath) : -1,
    [images, focusPath],
  );

  useVirtualJump(virtualizer, focusIndex, true, revealed);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-3 py-1.5 font-mono text-[10px] text-muted-foreground uppercase">
        <span className="w-12 shrink-0" />
        <span className="min-w-0 flex-1">Photo</span>
        {COLUMNS.map((column) => (
          <span
            key={column.label}
            className={cn("shrink-0 text-right", column.className)}
          >
            {column.label}
          </span>
        ))}
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
                  const intent = clickIntent(event, selected.size > 0);
                  if (intent === "open") onOpen?.(item.index);
                  else onSelect(image.path, intent);
                }}
                className={cn(
                  "absolute top-0 left-0 flex w-full items-center gap-3 px-3 text-left",
                  isSelected ? "bg-secondary" : "hover:bg-accent",
                  isCurrent && "ring-2 ring-primary ring-inset",
                )}
                style={{
                  height: ROW_HEIGHT,
                  transform: `translateY(${item.start}px)`,
                }}
              >
                <Thumbnail
                  file={image}
                  className={cn(
                    "h-8 w-12 shrink-0 rounded-sm",
                    rejectedFade(image.flag),
                  )}
                />
                <span className="min-w-0 flex-1 truncate font-mono text-xs">
                  {image.rel}
                </span>
                {COLUMNS.map((column) => (
                  <span
                    key={column.label}
                    className={cn(
                      "shrink-0 text-right font-mono text-xs",
                      column.className,
                    )}
                  >
                    {column.value(image)}
                  </span>
                ))}
                <span className="flex w-24 shrink-0 items-center justify-end gap-1.5 text-xs">
                  <ExposureBadge
                    exposure={image.edit.exposure}
                    className="font-mono text-[10px] text-muted-foreground"
                  />
                  <RatingBadge rating={image.rating} />
                  <PickMark flag={image.flag} />
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
