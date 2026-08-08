import { useDeferredValue, useEffect, useState } from "react";
import { fileSrc, type ImageGroup } from "@/lib/core";
import { usePrefetchRender, useRender, useThumbnail } from "@/lib/queries";
import { Stars } from "./Stars";

/// The file worth rendering: raw for real exposure scrubbing, else the
/// furthest-stage file.
function renderFileOf(image: ImageGroup | undefined) {
  return (
    image?.files.find((f) => f.stage === "raw") ??
    image?.files[image.files.length - 1]
  );
}

type Props = {
  images: ImageGroup[];
  index: number;
  onNavigate: (index: number) => void;
  onClose: () => void;
  onRate: (stem: string, rating: number) => void;
};

const EXPOSURE_STEP = 0.25;
const EXPOSURE_RANGE = 3;

/// Full-screen culling view. Exposure scrubs re-render through the raw
/// pipeline core-side (the whole reason this app is native); ratings are one
/// keystroke. Preview adjustments are never written to any file.
export function Loupe({ images, index, onNavigate, onClose, onRate }: Props) {
  const image = images[index];
  // Exposure persists across navigation: when culling a shoot that's all a
  // stop under, you set it once and flick through. `r` resets.
  const [exposure, setExposure] = useState(0);
  const deferredExposure = useDeferredValue(exposure);

  const renderFile = renderFileOf(image);
  const render = useRender(renderFile, deferredExposure);
  // While a cold render cooks, show this image's (grid-cached) thumbnail —
  // never the previous photo — so ratings are always judged on the right
  // pixels.
  const thumb = useThumbnail(image?.files[image.files.length - 1]);
  // Neighbors render ahead of the arrival of ← or →.
  usePrefetchRender(renderFileOf(images[index + 1]), deferredExposure);
  usePrefetchRender(renderFileOf(images[index - 1]), deferredExposure);

  useEffect(() => {
    if (!image) return;
    const handler = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
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
          onRate(image.stem, Number(event.key));
          break;
        case "ArrowUp":
          event.preventDefault();
          setExposure((v) => Math.min(v + EXPOSURE_STEP, EXPOSURE_RANGE));
          break;
        case "ArrowDown":
          event.preventDefault();
          setExposure((v) => Math.max(v - EXPOSURE_STEP, -EXPOSURE_RANGE));
          break;
        case "r":
          setExposure(0);
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [image, images.length, index, onClose, onNavigate, onRate]);

  if (!image) return null;

  return (
    <div
      data-testid="loupe"
      className="fixed inset-0 z-50 flex flex-col bg-black"
    >
      <div className="relative min-h-0 flex-1">
        {render.data ? (
          <img
            data-testid="loupe-image"
            src={fileSrc(render.data)}
            alt={image.stem}
            className="h-full w-full object-contain"
          />
        ) : thumb.data ? (
          <img
            data-testid="loupe-placeholder"
            src={fileSrc(thumb.data)}
            alt={image.stem}
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            rendering…
          </div>
        )}
        {(render.isFetching || !render.data) && (
          <div className="absolute top-3 right-3 h-2 w-2 animate-pulse rounded-full bg-primary" />
        )}
      </div>

      <div className="flex items-center gap-4 border-t border-border bg-background/90 px-4 py-2 text-sm">
        <span
          data-testid="loupe-position"
          className="font-mono text-xs text-muted-foreground"
        >
          {index + 1}/{images.length}
        </span>
        <span data-testid="loupe-stem" className="font-mono">
          {image.stem}
        </span>
        <Stars
          value={image.rating}
          onRate={(rating) => onRate(image.stem, rating)}
          className="text-lg"
        />
        <label className="ml-auto flex items-center gap-2 font-mono text-xs text-muted-foreground">
          EV
          <input
            data-testid="exposure"
            type="range"
            min={-EXPOSURE_RANGE}
            max={EXPOSURE_RANGE}
            step={0.1}
            value={exposure}
            onChange={(e) => setExposure(Number(e.target.value))}
            className="w-40 accent-[var(--pp-accent,#FF7A2F)]"
          />
          <span className="w-10 text-right">
            {exposure >= 0 ? "+" : ""}
            {exposure.toFixed(2)}
          </span>
        </label>
        <span className="text-xs text-muted-foreground">
          ←→ navigate · 1–5 rate · 0 clear · ↑↓ EV · r reset · esc
        </span>
      </div>
    </div>
  );
}
