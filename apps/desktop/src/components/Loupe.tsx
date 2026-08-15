import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type Edit, fileSrc, type ImageFile } from "@/lib/core";
import { aspectRatioFor, type Box, fitRect, rotatedSize } from "@/lib/crop";
import { capturePointer, cursorIn } from "@/lib/pointer";
import {
  useFullRender,
  usePrefetchRender,
  useRender,
  useThumbnail,
} from "@/lib/queries";
import {
  centerOn,
  clampPan,
  visibleRect,
  type ZoomState,
  zoomAt,
} from "@/lib/zoom";
import { type CropDraft, CropOverlay, draftWithAngle } from "./CropTool";
import { Filmstrip, type FilmstripMode } from "./Filmstrip";

export const EXPOSURE_STEP = 0.25;
export const EXPOSURE_RANGE = 3;

type Props = {
  images: ImageFile[];
  index: number;
  edit: Edit;
  filmstrip: FilmstripMode;
  cropDraft: CropDraft | null;
  onCropDraft: (draft: CropDraft) => void;
  onApplyCrop: () => void;
  onCancelCrop: () => void;
  onEditChange: (edit: Edit) => void;
  onNavigate: (index: number) => void;
  onClose: () => void;
  onRate: (path: string, rating: number) => void;
};

export function Loupe({
  images,
  index,
  edit,
  filmstrip,
  cropDraft,
  onCropDraft,
  onApplyCrop,
  onCancelCrop,
  onEditChange,
  onNavigate,
  onClose,
  onRate,
}: Props) {
  const image = images[index];
  const deferredEdit = useDeferredValue(edit);
  const cropping = cropDraft !== null;

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
  const render = useRender(image, previewEdit);
  const thumb = useThumbnail(image);
  usePrefetchRender(images[index + 1], images[index + 1]?.edit);
  usePrefetchRender(images[index - 1], images[index - 1]?.edit);

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

  const zoom = useZoom({
    stageRef,
    stage,
    photoBox,
    pixelWidth,
    enabled: !cropping && !!image,
    resetKey: `${image?.path}|${cropping}`,
  });
  const fullRender = useFullRender(image, previewEdit, zoom.state !== null);

  useEffect(() => {
    if (!image) return;
    const handler = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        event.key.startsWith("Arrow") &&
        target?.closest?.("[data-slot='slider']")
      ) {
        return;
      }
      if (cropping) {
        if (event.key === "Escape") onCancelCrop();
        // A focused button (Cancel, Reset) or the aspect select acts on
        // Enter itself.
        if (event.key === "Enter" && !target?.closest?.("button, select")) {
          onApplyCrop();
        }
        return;
      }
      switch (event.key) {
        case "Escape":
          onClose();
          break;
        case "ArrowRight":
          event.preventDefault();
          onNavigate(Math.min(index + 1, images.length - 1));
          break;
        case "ArrowLeft":
          event.preventDefault();
          onNavigate(Math.max(index - 1, 0));
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
    images.length,
    index,
    edit,
    cropping,
    onApplyCrop,
    onCancelCrop,
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
  const src =
    zoom.state !== null && fullRender.data ? fullRender.data : freshRender;
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
                onCropDraft(
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
              : zoom.state
                ? `translate(${zoom.state.tx}px, ${zoom.state.ty}px) scale(${zoom.state.scale})`
                : undefined,
          }}
        >
          {src ? (
            <img
              data-testid="loupe-image"
              src={fileSrc(src)}
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
        {cropDraft && photoBox.width > 0 && (
          <CropOverlay
            photoBox={photoBox}
            draft={cropDraft}
            imageWidth={displayWidth}
            imageHeight={displayHeight}
            ratio={ratio}
            onChange={onCropDraft}
          />
        )}
        {cropDraft && (
          <div
            data-testid="crop-angle-hud"
            className="absolute top-3 left-1/2 -translate-x-1/2 rounded-md border border-border bg-background/85 px-2.5 py-1 font-mono text-[11px] backdrop-blur-sm"
          >
            {`∠ ${cropDraft.angle > 0 ? "+" : ""}${cropDraft.angle.toFixed(1)}° · double-click to reset`}
          </div>
        )}
        {!cropping && zoom.state !== null && (
          <>
            <div
              data-testid="zoom-level"
              className="absolute bottom-3 left-3 rounded-md border border-border bg-background/85 px-2.5 py-1 font-mono text-[11px] backdrop-blur-sm"
            >
              {`${Math.round((zoom.state.scale / (zoom.scale100 || 1)) * 100)}% · double-click to fit`}
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
        {(render.isFetching || !render.data) && (
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
            onNavigate={onNavigate}
          />
        </div>
      )}
    </div>
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
    const onGestureStart = (event: Event) => {
      event.preventDefault();
      inGesture = true;
      gestureScale = 1;
    };
    const onGestureChange = (event: Event) => {
      event.preventDefault();
      const scale = (event as unknown as { scale: number }).scale;
      const position = event as unknown as { clientX: number; clientY: number };
      applyZoom(cursorIn(node, position), scale / gestureScale);
      gestureScale = scale;
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
  const dragging = useRef(false);

  const centerFrom = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    onCenter({
      x: (event.clientX - bounds.left) / bounds.width,
      y: (event.clientY - bounds.top) / bounds.height,
    });
  };

  if (box.width <= 0) return null;
  return (
    <div
      data-testid="zoom-navigator"
      className="absolute top-3 right-3 overflow-hidden rounded-lg border border-border shadow-lg"
      style={{ width: box.width, height: box.height }}
      onPointerDown={(event) => {
        dragging.current = true;
        capturePointer(event);
        centerFrom(event);
      }}
      onPointerMove={(event) => {
        if (dragging.current) centerFrom(event);
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
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
