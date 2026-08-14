import { useDeferredValue, useEffect } from "react";
import { fileSrc, type ImageFile } from "@/lib/core";
import { usePrefetchRender, useRender, useThumbnail } from "@/lib/queries";
import { Filmstrip, type FilmstripMode } from "./Filmstrip";

export const EXPOSURE_STEP = 0.25;
export const EXPOSURE_RANGE = 3;

type Props = {
  images: ImageFile[];
  index: number;
  exposure: number;
  filmstrip: FilmstripMode;
  onExposureChange: (ev: number) => void;
  onNavigate: (index: number) => void;
  onClose: () => void;
  onRate: (path: string, rating: number) => void;
};

export function Loupe({
  images,
  index,
  exposure,
  filmstrip,
  onExposureChange,
  onNavigate,
  onClose,
  onRate,
}: Props) {
  const image = images[index];
  const deferredExposure = useDeferredValue(exposure);

  const render = useRender(image, deferredExposure);
  const thumb = useThumbnail(image);
  usePrefetchRender(images[index + 1], images[index + 1]?.exposure ?? 0);
  usePrefetchRender(images[index - 1], images[index - 1]?.exposure ?? 0);

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
          onExposureChange(Math.min(exposure + EXPOSURE_STEP, EXPOSURE_RANGE));
          break;
        case "ArrowDown":
          event.preventDefault();
          onExposureChange(Math.max(exposure - EXPOSURE_STEP, -EXPOSURE_RANGE));
          break;
        case "r":
          onExposureChange(0);
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    image,
    images.length,
    index,
    exposure,
    onClose,
    onExposureChange,
    onNavigate,
    onRate,
  ]);

  if (!image) return null;

  return (
    <div data-testid="loupe" className="flex h-full flex-col bg-black">
      <div className="relative min-h-0 flex-1">
        {render.data ? (
          <img
            data-testid="loupe-image"
            src={fileSrc(render.data)}
            alt={image.rel}
            className="h-full w-full object-contain"
          />
        ) : thumb.data ? (
          <img
            data-testid="loupe-placeholder"
            src={fileSrc(thumb.data)}
            alt={image.rel}
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
      {filmstrip !== "off" && (
        <Filmstrip
          images={images}
          index={index}
          mode={filmstrip}
          onNavigate={onNavigate}
        />
      )}
    </div>
  );
}
