import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type Edit, fileSrc, type ImageFile } from "@/lib/core";
import { type Box, centeredAspectCrop, fitRect } from "@/lib/crop";
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
import {
  aspectRatio,
  type CropAspect,
  type CropDraft,
  CropOverlay,
  CropToolbar,
  commitDraft,
  draftFromEdit,
  draftWithAngle,
} from "./CropTool";
import { Filmstrip, type FilmstripMode } from "./Filmstrip";

export const EXPOSURE_STEP = 0.25;
export const EXPOSURE_RANGE = 3;

type Props = {
  images: ImageFile[];
  index: number;
  edit: Edit;
  filmstrip: FilmstripMode;
  cropping: boolean;
  onCroppingChange: (cropping: boolean) => void;
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
  cropping,
  onCroppingChange,
  onEditChange,
  onNavigate,
  onClose,
  onRate,
}: Props) {
  const image = images[index];
  const deferredEdit = useDeferredValue(edit);

  const previewEdit = useMemo(
    () =>
      cropping ? { ...deferredEdit, crop: null, cropAngle: 0 } : deferredEdit,
    [cropping, deferredEdit],
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
  // the full frame while cropping.
  const crop = cropping ? null : (edit.crop ?? null);
  const pixelWidth = (crop ? crop.right - crop.left : 1) * (image?.width ?? 0);
  const pixelHeight =
    (crop ? crop.bottom - crop.top : 1) * (image?.height ?? 0);
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

  const [draft, setDraft] = useState<CropDraft | null>(null);
  const [aspect, setAspect] = useState<CropAspect>("free");
  // biome-ignore lint/correctness/useExhaustiveDependencies: initialize the draft only on entry, not per keystroke
  useEffect(() => {
    if (cropping && image) {
      setDraft(draftFromEdit(edit));
      setAspect("free");
    } else {
      setDraft(null);
    }
  }, [cropping, image?.path]);

  const commitCrop = useCallback(() => {
    if (!draft) return;
    onEditChange({ ...edit, ...commitDraft(draft) });
    onCroppingChange(false);
  }, [draft, edit, onEditChange, onCroppingChange]);

  const cancelCrop = useCallback(
    () => onCroppingChange(false),
    [onCroppingChange],
  );

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
        // The aspect dropdown owns its own Enter/Escape while focused.
        if (
          target?.closest?.(
            "[data-slot='select-trigger'], [data-slot='select-content']",
          )
        ) {
          return;
        }
        if (event.key === "Escape") cancelCrop();
        if (event.key === "Enter") commitCrop();
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
    commitCrop,
    cancelCrop,
    onClose,
    onEditChange,
    onNavigate,
    onRate,
  ]);

  if (!image) return null;

  const src =
    zoom.state !== null && fullRender.data ? fullRender.data : render.data;
  const ratio = aspectRatio(aspect);

  const cropCenter = draft
    ? {
        x:
          photoBox.x +
          ((draft.crop.left + draft.crop.right) / 2) * photoBox.width,
        y:
          photoBox.y +
          ((draft.crop.top + draft.crop.bottom) / 2) * photoBox.height,
      }
    : null;

  return (
    <div data-testid="loupe" className="flex h-full flex-col bg-black">
      <div
        ref={stageRef}
        className="relative min-h-0 flex-1 touch-none overflow-hidden"
        {...(cropping ? {} : zoom.stageProps)}
      >
        <div
          className="absolute inset-0"
          style={{
            transformOrigin:
              cropping && cropCenter
                ? `${cropCenter.x}px ${cropCenter.y}px`
                : "0 0",
            transform:
              cropping && draft
                ? `rotate(${draft.angle}deg)`
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
        {cropping && draft && photoBox.width > 0 && (
          <CropOverlay
            photoBox={photoBox}
            draft={draft}
            imageWidth={image.width}
            imageHeight={image.height}
            ratio={ratio}
            onChange={setDraft}
          />
        )}
        {!cropping && zoom.state !== null && (
          <>
            <div
              data-testid="zoom-level"
              className="absolute bottom-3 left-3 rounded-md border border-border bg-background/85 px-2.5 py-1 font-mono text-[11px] backdrop-blur-sm"
            >
              {`${Math.round((zoom.state.scale / (zoom.scale100 || 1)) * 100)}% · double-click to fit`}
            </div>
            {thumb.data && (
              <Navigator
                thumbSrc={fileSrc(thumb.data)}
                pixelWidth={pixelWidth}
                pixelHeight={pixelHeight}
                cropRect={crop}
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
      {cropping && draft ? (
        <CropToolbar
          draft={draft}
          aspect={aspect}
          landscape={image.width >= image.height}
          onAspect={(next) => {
            setAspect(next);
            const nextRatio = aspectRatio(next);
            if (nextRatio !== null) {
              setDraft(
                (current) =>
                  current && {
                    ...current,
                    crop: centeredAspectCrop(
                      nextRatio,
                      current.angle,
                      image.width,
                      image.height,
                    ),
                  },
              );
            }
          }}
          onAngle={(angle) =>
            setDraft(
              (current) =>
                current &&
                draftWithAngle(current, angle, image.width, image.height),
            )
          }
          onReset={() => {
            setAspect("free");
            setDraft({
              crop: { left: 0, top: 0, right: 1, bottom: 1 },
              angle: 0,
            });
          }}
          onCancel={cancelCrop}
          onDone={commitCrop}
        />
      ) : (
        filmstrip !== "off" && (
          <Filmstrip
            images={images}
            index={index}
            mode={filmstrip}
            onNavigate={onNavigate}
          />
        )
      )}
    </div>
  );
}

/// Pinch (trackpad gesture or ctrl+wheel), two-finger pan, drag pan, and
/// double-click to toggle fit ↔ 100%.
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

    const cursorIn = (event: { clientX: number; clientY: number }) => {
      const bounds = node.getBoundingClientRect();
      return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    };

    let gestureScale = 1;
    let inGesture = false;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey) {
        if (inGesture) return;
        applyZoom(cursorIn(event), Math.exp(-event.deltaY * 0.01));
        return;
      }
      setState((current) => {
        if (!current) return current;
        const { photoBox, stage } = geometry.current;
        return clampPan(
          {
            ...current,
            tx: current.tx - event.deltaX,
            ty: current.ty - event.deltaY,
          },
          photoBox,
          stage.width,
          stage.height,
        );
      });
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
      applyZoom(cursorIn(position), scale / gestureScale);
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
  }, [stageRef, enabled, applyZoom]);

  const drag = useRef<{ x: number; y: number } | null>(null);

  const stageProps = {
    onDoubleClick: (event: React.MouseEvent) => {
      const node = stageRef.current;
      if (!node) return;
      const bounds = node.getBoundingClientRect();
      const cursor = {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      };
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
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: React.PointerEvent) => {
      const last = drag.current;
      if (!last) return;
      const dx = event.clientX - last.x;
      const dy = event.clientY - last.y;
      drag.current = { x: event.clientX, y: event.clientY };
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
  thumbSrc,
  pixelWidth,
  pixelHeight,
  cropRect,
  visible,
  onCenter,
}: {
  thumbSrc: string;
  pixelWidth: number;
  pixelHeight: number;
  cropRect: { left: number; top: number; right: number; bottom: number } | null;
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
        event.currentTarget.setPointerCapture(event.pointerId);
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
        src={thumbSrc}
        alt=""
        draggable={false}
        className="absolute max-w-none select-none"
        // The thumbnail is uncropped: blow it up so the crop region exactly
        // fills the navigator box. The box shares the crop's aspect, so the
        // stretch keeps the image's natural proportions.
        style={{
          width: `${100 / (cropRect ? cropRect.right - cropRect.left : 1)}%`,
          height: `${100 / (cropRect ? cropRect.bottom - cropRect.top : 1)}%`,
          left: `-${cropRect ? (cropRect.left / (cropRect.right - cropRect.left)) * 100 : 0}%`,
          top: `-${cropRect ? (cropRect.top / (cropRect.bottom - cropRect.top)) * 100 : 0}%`,
        }}
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
