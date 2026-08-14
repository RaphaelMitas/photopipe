import { useRef } from "react";
import type { CropRect } from "@/lib/core";
import {
  type Box,
  constrainCrop,
  cropInsideImage,
  fullCrop,
  isFullCrop,
} from "@/lib/crop";
import { Button } from "./ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Slider } from "./ui/slider";

export type CropDraft = { crop: CropRect; angle: number };

const LANDSCAPE_ASPECTS = ["3:2", "4:3", "5:4", "16:9", "16:10", "2:1"];
const PORTRAIT_ASPECTS = ["2:3", "3:4", "4:5", "9:16", "10:16", "1:2"];

/// "free", "1:1", or "width:height" straight from the dropdown.
export type CropAspect = string;

export function aspectRatio(aspect: CropAspect): number | null {
  if (aspect === "free") return null;
  const [width, height] = aspect.split(":").map(Number);
  return width / height;
}

const MIN_SIZE = 0.05;

type Handle = "tl" | "tr" | "bl" | "br" | "t" | "b" | "l" | "r" | "move";

type OverlayProps = {
  photoBox: Box;
  draft: CropDraft;
  imageWidth: number;
  imageHeight: number;
  ratio: number | null;
  onChange: (draft: CropDraft) => void;
};

export function CropOverlay({
  photoBox,
  draft,
  imageWidth,
  imageHeight,
  ratio,
  onChange,
}: OverlayProps) {
  const drag = useRef<{
    handle: Handle;
    pointerX: number;
    pointerY: number;
    start: CropRect;
  } | null>(null);

  const valid = (crop: CropRect) =>
    crop.right - crop.left >= MIN_SIZE &&
    crop.bottom - crop.top >= MIN_SIZE &&
    cropInsideImage(crop, draft.angle, imageWidth, imageHeight);

  const resize = (start: CropRect, handle: Handle, dx: number, dy: number) => {
    let { left, top, right, bottom } = start;
    if (handle.includes("l")) left += dx;
    if (handle.includes("r")) right += dx;
    if (handle.includes("t")) top += dy;
    if (handle.includes("b")) bottom += dy;
    if (ratio !== null) {
      // Width leads; the height follows from the pixel aspect. Anchor the
      // edge opposite the dragged corner.
      const height = ((right - left) * imageWidth) / ratio / imageHeight;
      if (handle.includes("t")) top = bottom - height;
      else bottom = top + height;
    }
    return { left, top, right, bottom };
  };

  const move = (start: CropRect, dx: number, dy: number): CropRect | null => {
    for (const [stepX, stepY] of [
      [dx, dy],
      [dx, 0],
      [0, dy],
    ]) {
      const crop = {
        left: start.left + stepX,
        top: start.top + stepY,
        right: start.right + stepX,
        bottom: start.bottom + stepY,
      };
      if (
        crop.left >= 0 &&
        crop.top >= 0 &&
        crop.right <= 1 &&
        crop.bottom <= 1 &&
        valid(crop)
      ) {
        return crop;
      }
    }
    return null;
  };

  const onPointerDown = (event: React.PointerEvent, handle: Handle) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      handle,
      pointerX: event.clientX,
      pointerY: event.clientY,
      start: draft.crop,
    };
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const active = drag.current;
    if (!active || photoBox.width <= 0 || photoBox.height <= 0) return;
    const dx = (event.clientX - active.pointerX) / photoBox.width;
    const dy = (event.clientY - active.pointerY) / photoBox.height;
    if (active.handle === "move") {
      const crop = move(active.start, dx, dy);
      if (crop) onChange({ ...draft, crop });
      return;
    }
    const crop = resize(active.start, active.handle, dx, dy);
    const clamped =
      crop.left >= 0 && crop.top >= 0 && crop.right <= 1 && crop.bottom <= 1;
    if (clamped && valid(crop)) onChange({ ...draft, crop });
  };

  const onPointerUp = () => {
    drag.current = null;
  };

  const { crop } = draft;
  const percent = (value: number) => `${value * 100}%`;
  const rect = {
    left: percent(crop.left),
    top: percent(crop.top),
    width: percent(crop.right - crop.left),
    height: percent(crop.bottom - crop.top),
  };

  const corner = "absolute size-3.5 border-2 border-white";
  const edge = "absolute bg-white";
  const handles: [Handle, string][] = [
    [
      "tl",
      `${corner} -top-px -left-px border-r-0 border-b-0 cursor-nwse-resize`,
    ],
    [
      "tr",
      `${corner} -top-px -right-px border-l-0 border-b-0 cursor-nesw-resize`,
    ],
    [
      "bl",
      `${corner} -bottom-px -left-px border-r-0 border-t-0 cursor-nesw-resize`,
    ],
    [
      "br",
      `${corner} -bottom-px -right-px border-l-0 border-t-0 cursor-nwse-resize`,
    ],
    [
      "t",
      `${edge} -top-0.5 left-1/2 h-1 w-6 -translate-x-1/2 cursor-ns-resize`,
    ],
    [
      "b",
      `${edge} -bottom-0.5 left-1/2 h-1 w-6 -translate-x-1/2 cursor-ns-resize`,
    ],
    [
      "l",
      `${edge} -left-0.5 top-1/2 h-6 w-1 -translate-y-1/2 cursor-ew-resize`,
    ],
    [
      "r",
      `${edge} -right-0.5 top-1/2 h-6 w-1 -translate-y-1/2 cursor-ew-resize`,
    ],
  ];

  return (
    <div
      data-testid="crop-overlay"
      className="absolute"
      style={{
        left: photoBox.x,
        top: photoBox.y,
        width: photoBox.width,
        height: photoBox.height,
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div
        className="absolute cursor-move outline outline-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]"
        style={rect}
        onPointerDown={(event) => onPointerDown(event, "move")}
      >
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute top-1/3 h-px w-full bg-white/30" />
          <div className="absolute top-2/3 h-px w-full bg-white/30" />
          <div className="absolute left-1/3 h-full w-px bg-white/30" />
          <div className="absolute left-2/3 h-full w-px bg-white/30" />
        </div>
        {(ratio === null ? handles : handles.slice(0, 4)).map(
          ([handle, className]) => (
            <div
              key={handle}
              data-testid={`crop-handle-${handle}`}
              className={className}
              onPointerDown={(event) => onPointerDown(event, handle)}
            />
          ),
        )}
      </div>
    </div>
  );
}

export const STRAIGHTEN_RANGE = 15;

type ToolbarProps = {
  draft: CropDraft;
  aspect: CropAspect;
  landscape: boolean;
  onAspect: (aspect: CropAspect) => void;
  onAngle: (angle: number) => void;
  onReset: () => void;
  onCancel: () => void;
  onDone: () => void;
};

export function CropToolbar({
  draft,
  aspect,
  landscape,
  onAspect,
  onAngle,
  onReset,
  onCancel,
  onDone,
}: ToolbarProps) {
  const groups: [string, string[]][] = [
    ["Landscape", LANDSCAPE_ASPECTS],
    ["Portrait", PORTRAIT_ASPECTS],
  ];
  if (!landscape) groups.reverse();
  const identity = isFullCrop(draft.crop) && draft.angle === 0;
  return (
    <div
      data-testid="crop-toolbar"
      className="flex shrink-0 items-center gap-5 border-t border-border bg-background/80 px-4 py-3"
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Aspect</span>
        <Select value={aspect} onValueChange={onAspect}>
          <SelectTrigger
            size="sm"
            data-testid="crop-aspect"
            className="text-xs"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="free" data-testid="crop-aspect-free">
              Free
            </SelectItem>
            <SelectItem value="1:1" data-testid="crop-aspect-1:1">
              1:1
            </SelectItem>
            {groups.map(([label, aspects]) => (
              <SelectGroup key={label}>
                <SelectLabel>{label}</SelectLabel>
                {aspects.map((value) => (
                  <SelectItem
                    key={value}
                    value={value}
                    data-testid={`crop-aspect-${value}`}
                  >
                    {value}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex min-w-56 flex-1 items-center gap-2 font-mono text-xs text-muted-foreground">
        <span>Straighten</span>
        <Slider
          data-testid="crop-angle"
          min={-STRAIGHTEN_RANGE}
          max={STRAIGHTEN_RANGE}
          step={0.1}
          value={[draft.angle]}
          onValueChange={([angle]) => onAngle(angle)}
          trackClassName="data-horizontal:h-1.5"
          rangeClassName="bg-transparent"
          className="max-w-64 **:data-[slot=slider-thumb]:h-3 **:data-[slot=slider-thumb]:w-3"
        />
        <span className="w-12 text-right tabular-nums text-foreground">
          {`${draft.angle > 0 ? "+" : ""}${draft.angle.toFixed(1)}°`}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          data-testid="crop-reset"
          disabled={identity}
          onClick={onReset}
          className="text-xs"
        >
          Reset
        </Button>
        <Button
          size="sm"
          variant="outline"
          data-testid="crop-cancel"
          onClick={onCancel}
          title="Cancel crop (esc)"
          className="text-xs"
        >
          Cancel
        </Button>
        <Button
          size="sm"
          data-testid="crop-done"
          onClick={onDone}
          title="Apply crop (⏎)"
          className="text-xs"
        >
          Done
        </Button>
      </div>
    </div>
  );
}

export function draftFromEdit(edit: {
  crop?: CropRect | null;
  cropAngle?: number;
}): CropDraft {
  return { crop: edit.crop ?? fullCrop, angle: edit.cropAngle ?? 0 };
}

export function commitDraft(draft: CropDraft): {
  crop: CropRect | null;
  cropAngle: number;
} {
  const identity = isFullCrop(draft.crop) && draft.angle === 0;
  return {
    crop: identity ? null : draft.crop,
    cropAngle: draft.angle,
  };
}

export function draftWithAngle(
  draft: CropDraft,
  angle: number,
  imageWidth: number,
  imageHeight: number,
): CropDraft {
  return {
    angle,
    crop: constrainCrop(draft.crop, angle, imageWidth, imageHeight),
  };
}
