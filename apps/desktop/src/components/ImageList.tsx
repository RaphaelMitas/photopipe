import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, Minus, Star } from "lucide-react";
import { useRef } from "react";
import { fileSrc, type ImageGroup, type Stage } from "@/lib/core";
import { useThumbnail } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { Skeleton } from "./ui/skeleton";

const ROW_HEIGHT = 44;

const STAGE_DOT: Record<Stage, string> = {
  raw: "bg-muted-foreground",
  denoised: "bg-sky-400",
  export: "bg-emerald-400",
};

/// What the trailing column shows. A stage page asks "has this page's output
/// arrived?"; Media shows the judgment info instead (rating + stage).
export type ListInfo =
  | { kind: "media" }
  | { kind: "stage"; produces: Stage; label: string };

function RowThumb({
  image,
  displayOriginal,
}: {
  image: ImageGroup;
  displayOriginal?: boolean;
}) {
  const thumb = useThumbnail(
    displayOriginal ? image.files[0] : image.files[image.files.length - 1],
  );
  if (!thumb.data) return <Skeleton className="h-8 w-12 shrink-0 rounded-sm" />;
  return (
    <img
      src={fileSrc(thumb.data)}
      alt={image.stem}
      loading="lazy"
      className="h-8 w-12 shrink-0 rounded-sm object-cover"
    />
  );
}

function InfoCell({ image, info }: { image: ImageGroup; info: ListInfo }) {
  if (info.kind === "media") {
    return (
      <span className="flex w-24 shrink-0 items-center justify-end gap-1.5 text-xs">
        {image.rating > 0 && (
          <span className="flex items-center gap-0.5 text-amber-400">
            <Star className="size-3 fill-amber-400" />
            {image.rating}
          </span>
        )}
        <span
          className={`h-1.5 w-1.5 rounded-full ${STAGE_DOT[image.stage]}`}
        />
      </span>
    );
  }
  const done = image.files.some((file) => file.stage === info.produces);
  return (
    <span className="flex w-24 shrink-0 items-center justify-end gap-1 text-xs">
      {done ? (
        <>
          <Check className="size-3.5 text-emerald-400" />
          <span className="text-muted-foreground">done</span>
        </>
      ) : (
        <>
          <Minus className="size-3.5 text-muted-foreground/40" />
          <span className="text-muted-foreground/60">waiting</span>
        </>
      )}
    </span>
  );
}

type Props = {
  images: ImageGroup[];
  info: ListInfo;
  selected: ReadonlySet<string>;
  /// Anything selected means select mode: plain clicks toggle.
  selectMode: boolean;
  onSelect: (
    stem: string,
    modifiers: { meta: boolean; shift: boolean },
  ) => void;
  /// Media only: a plain click outside select mode opens the loupe, same as
  /// the grid. Stage pages omit it and clicks always select.
  onOpen?: (index: number) => void;
  displayOriginal?: boolean;
  emptyMessage: string;
  /// Test hook: jsdom has no layout, so tests inject the viewport.
  initialRect?: { width: number; height: number };
};

/// The list half of the browser: every image as a row, with a per-stage info
/// column. Nothing is stored — the presence of a file *is* the state.
export function ImageList({
  images,
  info,
  selected,
  selectMode,
  onSelect,
  onOpen,
  displayOriginal,
  emptyMessage,
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

  if (images.length === 0) {
    return (
      <p
        data-testid="stage-empty"
        className="p-8 text-sm text-muted-foreground"
      >
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-3 py-1.5 font-mono text-[10px] text-muted-foreground uppercase">
        <span className="w-12 shrink-0" />
        <span className="min-w-0 flex-1">Photo</span>
        <span className="w-24 shrink-0 text-right">
          {info.kind === "media" ? "Rating" : info.label}
        </span>
      </div>
      <div
        ref={parentRef}
        data-testid="stage-table"
        className="min-h-0 flex-1 overflow-auto"
      >
        <div
          className="relative w-full"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const image = images[item.index];
            const isSelected = selected.has(image.stem);
            return (
              <button
                key={item.key}
                type="button"
                data-testid="stage-row"
                data-stem={image.stem}
                data-done={
                  info.kind === "stage"
                    ? image.files.some((f) => f.stage === info.produces)
                    : undefined
                }
                data-selected={isSelected}
                onClick={(event) => {
                  const meta = event.metaKey || event.ctrlKey;
                  if (onOpen && !meta && !event.shiftKey && !selectMode) {
                    onOpen(item.index);
                    return;
                  }
                  onSelect(image.stem, {
                    // Without an opener, a plain click means "select this
                    // one" — toggling, so clicking around never mass-clears.
                    meta: meta || (!onOpen && !event.shiftKey) || selectMode,
                    shift: event.shiftKey,
                  });
                }}
                className={cn(
                  "absolute top-0 left-0 flex w-full items-center gap-3 px-3 text-left",
                  isSelected ? "bg-secondary" : "hover:bg-accent",
                )}
                style={{
                  height: ROW_HEIGHT,
                  transform: `translateY(${item.start}px)`,
                }}
              >
                <RowThumb image={image} displayOriginal={displayOriginal} />
                <span className="min-w-0 flex-1 truncate font-mono text-xs">
                  {image.stem}
                </span>
                <InfoCell image={image} info={info} />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
