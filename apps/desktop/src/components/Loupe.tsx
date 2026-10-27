import { ChevronsLeftRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type Edit,
  fileSrc,
  framing,
  type ImageFile,
  identityEdit,
} from "@/lib/core";
import {
  aspectRatioFor,
  type Box,
  draftWithAngle,
  fitRect,
  moveCrop,
  rotatedSize,
} from "@/lib/crop";
import { clamp01 } from "@/lib/curve";
import { EXPOSURE_RANGE, EXPOSURE_STEP } from "@/lib/editSliders";
import { isModalOpen } from "@/lib/modal";
import { pluralize } from "@/lib/plural";
import { capturePointer, cursorIn, normalizedIn, useDrag } from "@/lib/pointer";
import {
  useDeferredEdit,
  usePrefetchRender,
  useRender,
  useThumbnail,
  useViewportRender,
} from "@/lib/queries";
import {
  pickInStack,
  type Stack,
  stackRating,
  stackRatingLabel,
  step,
} from "@/lib/stacks";
import type { CropSession } from "@/lib/useCropSession";
import {
  centerOn,
  clampPan,
  viewportKey,
  viewportRequest,
  visibleRect,
  visibleScreenRect,
  type ZoomState,
  zoomAt,
} from "@/lib/zoom";
import { CropOverlay } from "./CropTool";
import { Filmstrip, filmstripPref } from "./Filmstrip";

// Photo pixels, not screen pixels: ten of them stay a fine adjustment on any
// photo while still showing on screen at a fitted view.
const NUDGE_PIXELS = 10;
const NUDGE: Record<string, { x: number; y: number }> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

const CHIP =
  "rounded-md border border-border bg-background/85 px-2.5 py-1 font-mono text-[11px] backdrop-blur-sm";

// Keeping the framing keeps both halves of the split on the same pixels.
const unedited = (edit: Edit): Edit => ({ ...identityEdit, ...framing(edit) });

function usePrefetchNeighbour(
  photo: ImageFile | undefined,
  comparing: boolean,
) {
  const before = useMemo(() => photo && unedited(photo.edit), [photo]);
  usePrefetchRender(photo, photo?.edit);
  usePrefetchRender(comparing ? photo : undefined, before);
}

/// Holds a value back until it has stopped changing for `delayMs`.
function useSettled<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}

export type LoupeStacks = {
  list: Stack[];
  current: Stack;
  inside: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onPick: () => void;
};

type Props = {
  images: ImageFile[];
  index: number;
  edit: Edit;
  crop: CropSession;
  stacks: LoupeStacks | null;
  split: boolean;
  onEditChange: (edit: Edit) => void;
  onNavigate: (path: string) => void;
  onClose: () => void;
  onRate: (path: string, rating: number) => void;
};

export function Loupe({
  images,
  index,
  edit,
  crop: session,
  stacks,
  split,
  onEditChange,
  onNavigate,
  onClose,
  onRate,
}: Props) {
  const image = images[index];
  const cropDraft = session.draft;
  const deferredEdit = useDeferredEdit(image, edit);
  const cropping = cropDraft !== null;
  const comparing = split && !cropping;
  const filmstrip = filmstripPref.use();

  // While cropping the stage shows the full turned frame, uncropped and
  // unstraightened; the crop and the CSS angle preview sit on top.
  const draftRotation = cropDraft?.rotation ?? 0;
  const previewEdit = useMemo(
    () =>
      cropping
        ? { ...deferredEdit, crop: null, cropAngle: 0, rotation: draftRotation }
        : deferredEdit,
    [cropping, deferredEdit, draftRotation],
  );
  // Queries fetch in call order and an idle lane starts on the first, so the edit asks first.
  const render = useRender(image, previewEdit);
  const beforeEdit = useMemo(() => unedited(deferredEdit), [deferredEdit]);
  const before = useRender(comparing ? image : undefined, beforeEdit);
  const thumb = useThumbnail(image);
  const neighbour = (direction: 1 | -1) =>
    stacks && image
      ? step(stacks.list, image.path, stacks.inside, direction)
      : images[index + direction];
  const next = neighbour(1);
  const previous = neighbour(-1);
  // The render lane runs newest first, so neighbours wait for this photo's first attempt.
  const landed = [render, before].every(
    (query) => !query.isFetching || query.failureCount > 0,
  );
  usePrefetchNeighbour(landed ? next : undefined, comparing);
  usePrefetchNeighbour(landed ? previous : undefined, comparing);
  const multiFrame = stacks !== null && stacks.current.frames.length > 1;

  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      setStage({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Pixel size of what the stage currently shows: the crop while viewing,
  // the full turned frame while cropping.
  const rotation = cropping ? draftRotation : (edit.rotation ?? 0);
  const [displayWidth, displayHeight] = rotatedSize(
    image?.width ?? 0,
    image?.height ?? 0,
    rotation,
  );
  const crop = cropping ? null : (edit.crop ?? null);
  const pixelWidth = (crop ? crop.right - crop.left : 1) * displayWidth;
  const pixelHeight = (crop ? crop.bottom - crop.top : 1) * displayHeight;
  const photoBox = useMemo(
    () => fitRect(stage.width, stage.height, pixelWidth, pixelHeight),
    [stage, pixelWidth, pixelHeight],
  );

  const zoomKey = `${image?.path}|${cropping}`;
  const zoom = useZoom({
    stageRef,
    stage,
    photoBox,
    pixelWidth,
    enabled: !cropping && !!image,
    resetKey: zoomKey,
  });
  const wanted = useMemo(() => {
    const request = viewportRequest(
      zoom.state,
      photoBox,
      stage.width,
      stage.height,
      pixelWidth,
      pixelHeight,
      window.devicePixelRatio,
    );
    return request && { ...request, zoomKey };
  }, [zoom.state, photoBox, stage, pixelWidth, pixelHeight, zoomKey]);
  // Only ask once the gesture settles, or a pinch fires a render per frame.
  const settled = useSettled(wanted, 180);
  // A slice for a view, photo or mode you have left would render ahead of this one and land in the wrong place.
  const current =
    settled?.zoomKey === zoomKey && viewportKey(wanted) === viewportKey(settled)
      ? settled
      : null;
  const sharp = useViewportRender(image, previewEdit, current).data;
  const sharpBefore = useViewportRender(
    comparing ? image : undefined,
    beforeEdit,
    current,
  ).data;
  const sharpening = wanted !== null && (!sharp || (comparing && !sharpBefore));
  const [divider, setDivider] = useState(0.5);

  // Key repeat outruns re-rendering, so a nudge composes on the ref instead of
  // the draft this listener closed over.
  const draftRef = useRef(cropDraft);
  draftRef.current = cropDraft;

  useEffect(() => {
    if (!image) return;
    const handler = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // an open popover has already spent this Escape on closing itself
      if (event.defaultPrevented || isModalOpen()) return;
      const target = event.target instanceof Element ? event.target : null;
      if (
        event.key.startsWith("Arrow") &&
        target?.closest("[data-slot='slider'], select")
      ) {
        return;
      }
      const draft = draftRef.current;
      if (draft) {
        if (event.key === "Escape") {
          draftRef.current = null;
          session.cancel();
        }
        // A focused button (Cancel, Reset) or the aspect select acts on
        // Enter itself.
        if (event.key === "Enter" && !target?.closest("button, select")) {
          draftRef.current = null;
          session.apply();
        }
        const nudge = NUDGE[event.key];
        if (nudge) {
          event.preventDefault();
          const nudged = {
            ...draft,
            crop: moveCrop(
              draft.crop,
              (nudge.x * NUDGE_PIXELS) / displayWidth,
              (nudge.y * NUDGE_PIXELS) / displayHeight,
              draft.angle,
              displayWidth,
              displayHeight,
            ),
          };
          draftRef.current = nudged;
          session.set(nudged);
        }
        return;
      }
      switch (event.key) {
        case "Escape":
          if (stacks?.inside) stacks.onLeave();
          else onClose();
          break;
        case "ArrowRight":
          event.preventDefault();
          if (next) onNavigate(next.path);
          break;
        case "ArrowLeft":
          event.preventDefault();
          if (previous) onNavigate(previous.path);
          break;
        case "Enter":
          // a focused button acts on Enter itself
          if (multiFrame && !stacks.inside && !target?.closest("button")) {
            event.preventDefault();
            stacks.onEnter();
          }
          break;
        case "p":
        case "P":
          if (multiFrame && stacks.inside) stacks.onPick();
          break;
        case "0":
        case "1":
        case "2":
        case "3":
        case "4":
        case "5":
          onRate(image.path, Number(event.key));
          break;
        case "ArrowUp":
          event.preventDefault();
          onEditChange({
            ...edit,
            exposure: Math.min(edit.exposure + EXPOSURE_STEP, EXPOSURE_RANGE),
          });
          break;
        case "ArrowDown":
          event.preventDefault();
          onEditChange({
            ...edit,
            exposure: Math.max(edit.exposure - EXPOSURE_STEP, -EXPOSURE_RANGE),
          });
          break;
        case "r":
          onEditChange({ ...edit, exposure: 0 });
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    image,
    images,
    index,
    edit,
    displayWidth,
    displayHeight,
    session,
    stacks,
    multiFrame,
    next,
    previous,
    onClose,
    onEditChange,
    onNavigate,
    onRate,
  ]);

  if (!image) return null;

  // While cropping, a placeholder still has the old crop and rotation baked
  // in — the overlay and CSS rotation would not line up with it. Fall back to
  // the (uncropped) thumbnail until the full-frame render lands.
  const freshRender =
    cropping && render.isPlaceholderData ? undefined : render.data;
  // The slice sits outside the zoom transform, laid out at its own on-screen
  // size, so it is never a scaled-up copy of the fitted render.
  const sliceRect = zoom.state
    ? visibleScreenRect(zoom.state, photoBox, stage.width, stage.height)
    : null;
  const zoomTransform = zoom.state
    ? `translate(${zoom.state.tx}px, ${zoom.state.ty}px) scale(${zoom.state.scale})`
    : undefined;
  const ratio = cropDraft
    ? aspectRatioFor(
        cropDraft.aspect,
        cropDraft.flipped,
        displayWidth,
        displayHeight,
      )
    : null;

  // The straighten pivot is the photo's center: the photo stays put while
  // the crop rect moves over it, so dragging pans in view axes.
  const photoCenter = cropDraft
    ? {
        x: photoBox.x + photoBox.width / 2,
        y: photoBox.y + photoBox.height / 2,
      }
    : null;

  return (
    <div data-testid="loupe" className="flex h-full flex-col bg-black">
      <div
        ref={stageRef}
        className="relative min-h-0 flex-1 touch-none overflow-hidden"
        {...(cropDraft
          ? {
              onDoubleClick: () =>
                session.set(
                  draftWithAngle(cropDraft, 0, displayWidth, displayHeight),
                ),
            }
          : zoom.stageProps)}
      >
        <div
          className="absolute inset-0"
          style={{
            transformOrigin: photoCenter
              ? `${photoCenter.x}px ${photoCenter.y}px`
              : "0 0",
            transform: cropDraft
              ? `rotate(${cropDraft.angle}deg)`
              : zoomTransform,
          }}
        >
          {freshRender ? (
            <img
              data-testid="loupe-image"
              src={fileSrc(freshRender)}
              alt={image.rel}
              draggable={false}
              className="h-full w-full object-contain select-none"
            />
          ) : thumb.data ? (
            <img
              data-testid="loupe-placeholder"
              src={fileSrc(thumb.data)}
              alt={image.rel}
              draggable={false}
              className="h-full w-full object-contain select-none"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              rendering…
            </div>
          )}
        </div>
        <Slice
          testId="loupe-region"
          src={sharp}
          rect={sliceRect}
          alt={image.rel}
        />
        {comparing && (
          <>
            <div
              data-testid="loupe-before"
              className="pointer-events-none absolute inset-0 bg-black"
              style={{ clipPath: `inset(0 ${(1 - divider) * 100}% 0 0)` }}
            >
              <div
                className="absolute inset-0"
                style={{ transformOrigin: "0 0", transform: zoomTransform }}
              >
                {before.data && (
                  <img
                    data-testid="loupe-before-image"
                    src={fileSrc(before.data)}
                    alt={image.rel}
                    draggable={false}
                    className="h-full w-full object-contain select-none"
                  />
                )}
              </div>
              <Slice
                testId="loupe-before-region"
                src={sharpBefore}
                rect={sliceRect}
                alt={image.rel}
              />
            </div>
            <SplitDivider
              stageRef={stageRef}
              at={divider}
              onMove={setDivider}
            />
          </>
        )}
        {cropDraft && photoBox.width > 0 && (
          <CropOverlay
            photoBox={photoBox}
            draft={cropDraft}
            imageWidth={displayWidth}
            imageHeight={displayHeight}
            ratio={ratio}
            onChange={session.set}
          />
        )}
        {cropDraft && (
          <div
            data-testid="crop-angle-hud"
            className={`${CHIP} absolute top-3 left-1/2 -translate-x-1/2`}
          >
            {`∠ ${cropDraft.angle > 0 ? "+" : ""}${cropDraft.angle.toFixed(1)}° · double-click to reset`}
          </div>
        )}
        {!cropping && zoom.state !== null && (
          <>
            <div
              data-testid="zoom-level"
              className={`${CHIP} absolute bottom-3 left-3`}
            >
              {`${Math.round((zoom.state.scale / (zoom.scale100 || 1)) * 100)}% · ${
                sharpening ? "sharpening…" : "double-click to fit"
              }`}
            </div>
            {render.data && (
              // The preview render has the crop and turn baked in, so it maps
              // onto the navigator box without any stretch arithmetic.
              <Navigator
                src={fileSrc(render.data)}
                pixelWidth={pixelWidth}
                pixelHeight={pixelHeight}
                visible={visibleRect(
                  zoom.state,
                  photoBox,
                  stage.width,
                  stage.height,
                )}
                onCenter={zoom.centerAt}
              />
            )}
          </>
        )}
        {multiFrame && !cropping && (
          <StackOverlay stacks={stacks} path={image.path} />
        )}
        {(render.isFetching ||
          !render.data ||
          (comparing && (before.isFetching || !before.data))) && (
          <div className="absolute top-3 right-3 h-2 w-2 animate-pulse rounded-full bg-primary" />
        )}
      </div>
      {filmstrip !== "off" && (
        // Navigating away would silently discard the crop draft.
        <div
          className={cropping ? "pointer-events-none opacity-40" : undefined}
        >
          <Filmstrip
            images={images}
            index={index}
            mode={filmstrip}
            stacks={stacks}
            onNavigate={onNavigate}
          />
        </div>
      )}
    </div>
  );
}

// a zoomed stage captures the pointer on press, which would swallow the click
const ownTap = {
  onPointerDown: (event: React.PointerEvent) => event.stopPropagation(),
  onDoubleClick: (event: React.MouseEvent) => event.stopPropagation(),
};

function Slice({
  testId,
  src,
  rect,
  alt,
}: {
  testId: string;
  src: string | undefined;
  rect: ReturnType<typeof visibleScreenRect> | null;
  alt: string;
}) {
  if (!src || !rect) return null;
  return (
    <img
      data-testid={testId}
      src={fileSrc(src)}
      alt={alt}
      draggable={false}
      className="pointer-events-none absolute select-none"
      style={{
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      }}
    />
  );
}

function SplitDivider({
  stageRef,
  at,
  onMove,
}: {
  stageRef: React.RefObject<HTMLDivElement | null>;
  at: number;
  onMove: (at: number) => void;
}) {
  const drag = useDrag((event) => {
    const node = stageRef.current;
    if (node) onMove(clamp01(normalizedIn(node, event).x));
  });
  return (
    <>
      <button
        type="button"
        data-testid="split-divider"
        aria-label="Drag to compare before and after"
        className="absolute inset-y-0 w-4 -translate-x-1/2 cursor-ew-resize"
        style={{ left: `${at * 100}%` }}
        {...drag}
        onPointerDown={(event) => {
          ownTap.onPointerDown(event);
          drag.onPointerDown(event);
        }}
        onDoubleClick={ownTap.onDoubleClick}
      >
        <span className="mx-auto block h-full w-0.5 bg-white/90" />
        <span className="absolute top-1/2 left-1/2 flex h-9 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-md border border-white/70 bg-background/85 text-white">
          <ChevronsLeftRight className="size-3" />
        </span>
      </button>
      <span
        className={`${CHIP} pointer-events-none absolute top-3 font-semibold`}
        style={{ right: `calc(${(1 - at) * 100}% + 10px)` }}
      >
        Before
      </span>
      <span
        className={`${CHIP} pointer-events-none absolute top-3`}
        style={{ left: `calc(${at * 100}% + 10px)` }}
      >
        After
      </span>
    </>
  );
}

function StackOverlay({ stacks, path }: { stacks: LoupeStacks; path: string }) {
  const { frames } = stacks.current;
  const rating = stackRating(stacks.current);
  const label = stackRatingLabel(stacks.current);
  const { kept, cleared } = pickInStack(stacks.current, path);
  return (
    <>
      <button
        type="button"
        data-testid="stack-chip"
        {...ownTap}
        onClick={stacks.inside ? stacks.onLeave : stacks.onEnter}
        className={`${CHIP} absolute top-3 left-3 flex items-center gap-2`}
      >
        {stacks.inside ? (
          <>
            <span className="font-semibold">Inside stack</span>
            <span className="text-muted-foreground">
              {frames.findIndex((frame) => frame.path === path) + 1} of{" "}
              {frames.length} · esc to go up
            </span>
          </>
        ) : (
          <>
            <span className="font-semibold">{frames.length} frames</span>
            {label && <span className="text-amber-400">{label}</span>}
            <span className="text-muted-foreground">enter to look inside</span>
          </>
        )}
      </button>
      {stacks.inside && (
        <button
          type="button"
          data-testid="stack-pick"
          {...ownTap}
          onClick={stacks.onPick}
          className="absolute bottom-4 left-1/2 flex w-max max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2.5 rounded-lg border border-primary/60 bg-background/95 py-1.5 pr-1.5 pl-3 text-sm shadow-lg backdrop-blur-sm"
        >
          <span className="font-semibold">Pick this one</span>
          <span className="font-mono text-[11px] text-muted-foreground">
            {rating > 0 ? "keeps " : "gets "}
            <span className="text-amber-400">{`★${kept}`}</span>
            {cleared > 0
              ? ` · clears ${pluralize(cleared, "other")}`
              : rating === 0 &&
                ` · ${pluralize(frames.length - 1, "other")} ${frames.length === 2 ? "stays" : "stay"} unrated`}
          </span>
          <kbd className="rounded bg-muted px-1.5 font-mono text-xs">P</kbd>
        </button>
      )}
    </>
  );
}

/// Pinch (trackpad gesture or ctrl+wheel), two-finger pan, drag pan, and
/// double-click to toggle fit ↔ 100% (min 2× for photos that barely
/// outresolve the viewport).
function useZoom({
  stageRef,
  stage,
  photoBox,
  pixelWidth,
  enabled,
  resetKey,
}: {
  stageRef: React.RefObject<HTMLDivElement | null>;
  stage: { width: number; height: number };
  photoBox: Box;
  pixelWidth: number;
  enabled: boolean;
  resetKey: string;
}) {
  const [state, setState] = useState<ZoomState | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the photo or mode changes
  useEffect(() => setState(null), [resetKey]);

  const scale100 = photoBox.width > 0 ? pixelWidth / photoBox.width : 0;
  const maxScale = Math.max(scale100 * 2, 2);

  const geometry = useRef({ photoBox, stage, scale100, maxScale });
  geometry.current = { photoBox, stage, scale100, maxScale };

  useEffect(() => {
    setState((current) =>
      current
        ? clampPan(current, photoBox, stage.width, stage.height)
        : current,
    );
  }, [photoBox, stage]);

  const panBy = useCallback((dx: number, dy: number) => {
    setState((current) => {
      if (!current) return current;
      const { photoBox, stage } = geometry.current;
      return clampPan(
        { ...current, tx: current.tx + dx, ty: current.ty + dy },
        photoBox,
        stage.width,
        stage.height,
      );
    });
  }, []);

  const applyZoom = useCallback(
    (cursor: { x: number; y: number }, factor: number) => {
      const { photoBox, stage, maxScale } = geometry.current;
      if (photoBox.width <= 0) return;
      setState((current) =>
        zoomAt(
          current,
          cursor,
          factor,
          maxScale,
          photoBox,
          stage.width,
          stage.height,
        ),
      );
    },
    [],
  );

  useEffect(() => {
    const node = stageRef.current;
    if (!node || !enabled) return;

    let gestureScale = 1;
    let inGesture = false;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey) {
        if (inGesture) return;
        applyZoom(cursorIn(node, event), Math.exp(-event.deltaY * 0.01));
        return;
      }
      panBy(-event.deltaX, -event.deltaY);
    };
    // WebKit reports trackpad pinches as gesture events, not ctrl+wheel.
    const onGestureStart = (event: GestureEvent) => {
      event.preventDefault();
      inGesture = true;
      gestureScale = 1;
    };
    const onGestureChange = (event: GestureEvent) => {
      event.preventDefault();
      applyZoom(cursorIn(node, event), event.scale / gestureScale);
      gestureScale = event.scale;
    };
    const onGestureEnd = () => {
      inGesture = false;
    };

    node.addEventListener("wheel", onWheel, { passive: false });
    node.addEventListener("gesturestart", onGestureStart);
    node.addEventListener("gesturechange", onGestureChange);
    node.addEventListener("gestureend", onGestureEnd);
    return () => {
      node.removeEventListener("wheel", onWheel);
      node.removeEventListener("gesturestart", onGestureStart);
      node.removeEventListener("gesturechange", onGestureChange);
      node.removeEventListener("gestureend", onGestureEnd);
    };
  }, [stageRef, enabled, applyZoom, panBy]);

  const drag = useRef<{ x: number; y: number } | null>(null);

  const stageProps = {
    onDoubleClick: (event: React.MouseEvent) => {
      const node = stageRef.current;
      if (!node) return;
      const cursor = cursorIn(node, event);
      setState((current) => {
        if (current) return null;
        const { photoBox, stage, scale100 } = geometry.current;
        if (photoBox.width <= 0) return null;
        const target = Math.max(scale100, 2);
        return zoomAt(
          null,
          cursor,
          target,
          target,
          photoBox,
          stage.width,
          stage.height,
        );
      });
    },
    onPointerDown: (event: React.PointerEvent) => {
      if (!state || event.button !== 0) return;
      drag.current = { x: event.clientX, y: event.clientY };
      capturePointer(event);
    },
    onPointerMove: (event: React.PointerEvent) => {
      const last = drag.current;
      if (!last) return;
      const dx = event.clientX - last.x;
      const dy = event.clientY - last.y;
      drag.current = { x: event.clientX, y: event.clientY };
      panBy(dx, dy);
    },
    onPointerUp: () => {
      drag.current = null;
    },
    style: { cursor: state ? "grab" : undefined },
  };

  const centerAt = useCallback((point: { x: number; y: number }) => {
    setState((current) => {
      if (!current) return current;
      const { photoBox, stage } = geometry.current;
      return centerOn(current, point, photoBox, stage.width, stage.height);
    });
  }, []);

  return { state, stageProps, scale100, centerAt };
}

function Navigator({
  src,
  pixelWidth,
  pixelHeight,
  visible,
  onCenter,
}: {
  src: string;
  pixelWidth: number;
  pixelHeight: number;
  visible: Box;
  onCenter: (point: { x: number; y: number }) => void;
}) {
  const box = fitRect(160, 120, pixelWidth, pixelHeight);
  const drag = useDrag((event) =>
    onCenter(normalizedIn(event.currentTarget, event)),
  );

  if (box.width <= 0) return null;
  return (
    <div
      data-testid="zoom-navigator"
      className="absolute top-3 right-3 overflow-hidden rounded-lg border border-border shadow-lg"
      style={{ width: box.width, height: box.height }}
      {...drag}
    >
      <img
        src={src}
        alt=""
        draggable={false}
        className="h-full w-full select-none object-cover"
      />
      <div
        className="pointer-events-none absolute border-[1.5px] border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
        style={{
          left: `${visible.x * 100}%`,
          top: `${visible.y * 100}%`,
          width: `${visible.width * 100}%`,
          height: `${visible.height * 100}%`,
        }}
      />
    </div>
  );
}
