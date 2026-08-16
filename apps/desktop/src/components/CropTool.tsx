import { Button } from "@photopipe/ui/components/button";
import { Check, ChevronDown, RotateCw, X } from "lucide-react";
import { useRef, useState } from "react";
import type { CropRect, ImageFile } from "@/lib/core";
import {
  aspectRatioFor,
  type Box,
  type CropHandle,
  centeredAspectCrop,
  constrainCrop,
  fullCrop,
  isFullCrop,
  moveCrop,
  resizeCrop,
  rotatedSize,
  snapCropEdges,
  transposeCrop,
  turnCrop,
} from "@/lib/crop";
import { capturePointer, cursorIn } from "@/lib/pointer";

export type CropDraft = {
  crop: CropRect;
  angle: number;
  rotation: number;
  aspect: string;
  flipped: boolean;
};

// Freehand corner rotation runs the full circle; ±180 covers it after the
// wrap-safe accumulation.
const STRAIGHTEN_RANGE = 180;

const ASPECTS: [string, string][] = [
  ["free", "Free"],
  ["original", "Original"],
  ["transposed", "Transposed"],
  ["1:1", "1:1"],
  ["4:5", "4:5"],
  ["2:3", "2:3"],
  ["3:4", "3:4"],
  ["5:7", "5:7"],
  ["16:9", "16:9"],
  ["16:10", "16:10"],
  ["21:9", "21:9"],
];

/// The dropdown entry a crop already sits at, so re-entering crop mode keeps
/// a locked shape locked. Unflipped matches win, and an unrecognised shape
/// falls back to Original without reshaping the rect.
function matchAspect(
  crop: CropRect,
  displayWidth: number,
  displayHeight: number,
): { aspect: string; flipped: boolean } {
  const ratio =
    ((crop.right - crop.left) * displayWidth) /
    ((crop.bottom - crop.top) * displayHeight);
  for (const flipped of [false, true]) {
    for (const [value] of ASPECTS) {
      const candidate = aspectRatioFor(
        value,
        flipped,
        displayWidth,
        displayHeight,
      );
      // 0.5%: a crop that round-tripped through the sidecar's three decimals
      // comes back a hair off its ratio.
      if (candidate !== null && Math.abs(candidate - ratio) < ratio * 0.005) {
        return { aspect: value, flipped };
      }
    }
  }
  return { aspect: "original", flipped: false };
}

export function draftFromEdit(
  edit: {
    crop?: CropRect | null;
    cropAngle?: number;
    rotation?: number;
  },
  imageWidth: number,
  imageHeight: number,
): CropDraft {
  const crop = edit.crop ?? fullCrop;
  const rotation = edit.rotation ?? 0;
  const [displayWidth, displayHeight] = rotatedSize(
    imageWidth,
    imageHeight,
    rotation,
  );
  return {
    crop,
    angle: edit.cropAngle ?? 0,
    rotation,
    ...matchAspect(crop, displayWidth, displayHeight),
  };
}

export function isIdentityDraft(draft: CropDraft): boolean {
  return isFullCrop(draft.crop) && draft.angle === 0 && draft.rotation === 0;
}

export function commitDraft(draft: CropDraft): {
  crop: CropRect | null;
  cropAngle: number;
  rotation: number;
} {
  // A near-flush sliver like left=3e-05 would survive isFullCrop yet
  // round-trip badly through the sidecar's decimal formatting.
  const crop = snapCropEdges(draft.crop, 0.001);
  const identity = isFullCrop(crop) && draft.angle === 0;
  return {
    crop: identity ? null : crop,
    cropAngle: draft.angle,
    rotation: draft.rotation,
  };
}

export function draftWithAngle(
  draft: CropDraft,
  angle: number,
  imageWidth: number,
  imageHeight: number,
): CropDraft {
  const clamped = Math.min(
    Math.max(angle, -STRAIGHTEN_RANGE),
    STRAIGHTEN_RANGE,
  );
  return {
    ...draft,
    angle: clamped,
    crop: constrainCrop(draft.crop, clamped, imageWidth, imageHeight),
  };
}

type PanelProps = {
  image: ImageFile;
  draft: CropDraft;
  onDraft: (draft: CropDraft) => void;
  onApply: () => void;
  onCancel: () => void;
};

/// The crop section that replaces the "Crop & straighten" button in the edit
/// panel while cropping; straightening happens on the photo itself.
export function CropPanel({
  image,
  draft,
  onDraft,
  onApply,
  onCancel,
}: PanelProps) {
  const [displayWidth, displayHeight] = rotatedSize(
    image.width,
    image.height,
    draft.rotation,
  );

  const applyAspect = (next: CropDraft) => {
    const ratio = aspectRatioFor(
      next.aspect,
      next.flipped,
      displayWidth,
      displayHeight,
    );
    return ratio === null
      ? next
      : {
          ...next,
          crop: centeredAspectCrop(
            ratio,
            next.angle,
            displayWidth,
            displayHeight,
          ),
        };
  };

  return (
    <div data-testid="crop-panel" className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <span className="font-medium text-sm">Crop</span>
        <Button
          variant="ghost"
          size="sm"
          data-testid="crop-reset"
          disabled={isIdentityDraft(draft)}
          onClick={() =>
            onDraft({
              crop: fullCrop,
              angle: 0,
              rotation: 0,
              aspect: "original",
              flipped: false,
            })
          }
          className="ml-auto h-6 px-1.5 text-[10px] text-muted-foreground"
        >
          Reset
        </Button>
      </div>
      <div className="flex flex-col gap-1.5 text-muted-foreground text-xs">
        <span>Ratio</span>
        <div className="flex items-center gap-1.5">
          {/* A native select: WKWebView shows the macOS popup menu, and the
              Radix portal version never opened there. */}
          <div className="relative flex-1">
            <select
              data-testid="crop-aspect"
              value={draft.aspect}
              onChange={(event) =>
                onDraft(applyAspect({ ...draft, aspect: event.target.value }))
              }
              className="h-8 w-full appearance-none rounded-3xl border border-transparent bg-input/50 px-3 pr-8 text-foreground text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
            >
              {ASPECTS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          </div>
          <Button
            variant={draft.flipped ? "secondary" : "outline"}
            size="icon"
            data-testid="crop-flip"
            title="Flip horizontal ↔ vertical"
            onClick={() =>
              onDraft({
                ...draft,
                flipped: !draft.flipped,
                crop: transposeCrop(
                  draft.crop,
                  draft.angle,
                  displayWidth,
                  displayHeight,
                ),
              })
            }
            className="size-8"
          >
            ⇄
          </Button>
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        data-testid="crop-turn"
        onClick={() =>
          onDraft({
            ...draft,
            rotation: (draft.rotation + 90) % 360,
            crop: turnCrop(draft.crop),
            // Fixed presets need the flip so the lock follows the turned
            // rect; original/transposed already follow via the swapped frame
            // dims, and free has nothing to lock.
            flipped: draft.aspect.includes(":")
              ? !draft.flipped
              : draft.flipped,
          })
        }
        className="text-xs"
      >
        <RotateCw />
        Turn 90°
      </Button>
      <div className="flex gap-1.5">
        <Button
          variant="outline"
          size="sm"
          data-testid="crop-cancel"
          onClick={onCancel}
          title="Cancel crop (esc)"
          className="flex-1 text-xs"
        >
          <X />
          Cancel
        </Button>
        <Button
          size="sm"
          data-testid="crop-apply"
          onClick={onApply}
          title="Apply crop (⏎)"
          className="flex-1 text-xs"
        >
          <Check />
          Apply
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Drag outside a corner to straighten · ⌥-drag along a line to level it ·
        double-click resets the angle
      </p>
    </div>
  );
}

type Handle = CropHandle | "move";

const rotateCursor = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 20 20'><path d='M4 10a6 6 0 1 1 2 4.5' fill='none' stroke='white' stroke-width='2'/><path d='M3 11l3 4 2-4z' fill='white'/></svg>`,
)}") 10 10, grabbing`;

type Drag =
  | {
      kind: "handle";
      handle: Handle;
      pointerX: number;
      pointerY: number;
      start: CropRect;
    }
  | { kind: "rotate"; lastPointerAngle: number; angle: number }
  | {
      kind: "align";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      startDraft: CropDraft;
    };

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
  const rootRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [alignLine, setAlignLine] = useState<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } | null>(null);

  const pointInRoot = (event: React.PointerEvent) =>
    rootRef.current ? cursorIn(rootRef.current, event) : { x: 0, y: 0 };

  const pointerAngle = (event: React.PointerEvent) => {
    const point = pointInRoot(event);
    const centerX = ((draft.crop.left + draft.crop.right) / 2) * photoBox.width;
    const centerY =
      ((draft.crop.top + draft.crop.bottom) / 2) * photoBox.height;
    return (Math.atan2(point.y - centerY, point.x - centerX) * 180) / Math.PI;
  };

  // The line's screen tilt, folded into (-90, 90] so leveling never turns
  // the photo upside down.
  const lineAngle = (line: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }) => {
    let angle =
      (Math.atan2(line.y2 - line.y1, line.x2 - line.x1) * 180) / Math.PI;
    if (angle > 90) angle -= 180;
    if (angle <= -90) angle += 180;
    return angle;
  };

  const onPointerDown = (event: React.PointerEvent, handle: Handle) => {
    if (event.altKey) return;
    event.preventDefault();
    event.stopPropagation();
    capturePointer(event);
    drag.current = {
      kind: "handle",
      handle,
      pointerX: event.clientX,
      pointerY: event.clientY,
      start: draft.crop,
    };
  };

  const onRotateDown = (event: React.PointerEvent) => {
    if (event.altKey) return;
    event.preventDefault();
    event.stopPropagation();
    capturePointer(event);
    drag.current = {
      kind: "rotate",
      lastPointerAngle: pointerAngle(event),
      angle: draft.angle,
    };
  };

  const onRootPointerDown = (event: React.PointerEvent) => {
    if (!event.altKey) return;
    event.preventDefault();
    capturePointer(event);
    const point = pointInRoot(event);
    drag.current = {
      kind: "align",
      x1: point.x,
      y1: point.y,
      x2: point.x,
      y2: point.y,
      startDraft: draft,
    };
    setAlignLine({ x1: point.x, y1: point.y, x2: point.x, y2: point.y });
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const active = drag.current;
    if (!active || photoBox.width <= 0 || photoBox.height <= 0) return;
    if (active.kind === "align") {
      const point = pointInRoot(event);
      active.x2 = point.x;
      active.y2 = point.y;
      setAlignLine({
        x1: active.x1,
        y1: active.y1,
        x2: active.x2,
        y2: active.y2,
      });
      return;
    }
    if (active.kind === "rotate") {
      // Accumulate wrap-safe deltas so freehand rotation runs past ±90°
      // without jumping at the atan2 seam.
      const pointer = pointerAngle(event);
      let delta = pointer - active.lastPointerAngle;
      if (delta > 180) delta -= 360;
      if (delta <= -180) delta += 360;
      active.lastPointerAngle = pointer;
      // Clamp the accumulator too, or winding past the limit builds up
      // slack that must be dragged back before the photo responds again.
      active.angle = Math.min(
        Math.max(active.angle + delta, -STRAIGHTEN_RANGE),
        STRAIGHTEN_RANGE,
      );
      onChange(draftWithAngle(draft, active.angle, imageWidth, imageHeight));
      return;
    }
    const dx = (event.clientX - active.pointerX) / photoBox.width;
    const dy = (event.clientY - active.pointerY) / photoBox.height;
    if (active.handle === "move") {
      onChange({
        ...draft,
        crop: moveCrop(
          active.start,
          dx,
          dy,
          draft.angle,
          imageWidth,
          imageHeight,
        ),
      });
      return;
    }
    onChange({
      ...draft,
      crop: resizeCrop(
        active.start,
        active.handle,
        dx,
        dy,
        ratio,
        draft.angle,
        imageWidth,
        imageHeight,
      ),
    });
  };

  const onPointerUp = () => {
    const active = drag.current;
    drag.current = null;
    if (active?.kind !== "align") return;
    setAlignLine(null);
    const drawn = Math.hypot(active.x2 - active.x1, active.y2 - active.y1);
    if (drawn < 10) return;
    onChange(
      draftWithAngle(
        active.startDraft,
        active.startDraft.angle - lineAngle(active),
        imageWidth,
        imageHeight,
      ),
    );
  };

  const { crop } = draft;
  const percent = (value: number) => `${value * 100}%`;
  const rect = {
    left: percent(crop.left),
    top: percent(crop.top),
    width: percent(crop.right - crop.left),
    height: percent(crop.bottom - crop.top),
  };

  // The drawn handles are thin; the pseudo-element gives each one a grab area
  // 8px wider on every side without changing how it looks.
  const hitArea = "before:absolute before:-inset-2 before:content-['']";
  const corner = `absolute size-3.5 border-2 border-white ${hitArea}`;
  const edge = `absolute bg-white ${hitArea}`;
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
  const rotateZones = [
    "-top-7 -left-7",
    "-top-7 -right-7",
    "-bottom-7 -left-7",
    "-bottom-7 -right-7",
  ];

  return (
    <div
      ref={rootRef}
      data-testid="crop-overlay"
      className="absolute"
      style={{
        left: photoBox.x,
        top: photoBox.y,
        width: photoBox.width,
        height: photoBox.height,
      }}
      onPointerDown={onRootPointerDown}
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
        {rotateZones.map((position) => (
          <div
            key={position}
            data-testid="crop-rotate-zone"
            className={`absolute size-7 ${position}`}
            style={{ cursor: rotateCursor }}
            onPointerDown={onRotateDown}
          />
        ))}
        {handles.map(([handle, className]) => (
          <div
            key={handle}
            data-testid={`crop-handle-${handle}`}
            className={className}
            onPointerDown={(event) => onPointerDown(event, handle)}
          />
        ))}
      </div>
      {alignLine && (
        <svg
          data-testid="crop-align-line"
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden="true"
        >
          <line
            x1={alignLine.x1}
            y1={alignLine.y1}
            x2={alignLine.x2}
            y2={alignLine.y2}
            stroke="white"
            strokeWidth="2"
            strokeDasharray="6 4"
          />
          <circle cx={alignLine.x1} cy={alignLine.y1} r="3.5" fill="#f97316" />
          <circle cx={alignLine.x2} cy={alignLine.y2} r="3.5" fill="#f97316" />
        </svg>
      )}
    </div>
  );
}
