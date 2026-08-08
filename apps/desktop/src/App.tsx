import { ChevronLeft } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import { Dashboard, StageCounts } from "@/components/Dashboard";
import type { FilmstripMode } from "@/components/Filmstrip";
import { ImageGrid } from "@/components/ImageGrid";
import { Loupe } from "@/components/Loupe";
import { LoupeSidebar } from "@/components/LoupeSidebar";
import { RootPicker, rememberRoot } from "@/components/RootPicker";
import { Button } from "@/components/ui/button";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { coreRequest, type SetRootResult } from "@/lib/core";
import {
  useGenerationPoll,
  useImages,
  useSetRating,
  useShoots,
} from "@/lib/queries";

const ROOT_KEY = "photopipe.root";

type RootState =
  | { kind: "picking"; error: string | null; busy: boolean }
  | { kind: "ready"; path: string; generation: number };

export default function App() {
  const [rootState, setRootState] = useState<RootState>({
    kind: "picking",
    error: null,
    busy: false,
  });
  const [openShoot, setOpenShoot] = useState<string | null>(null);
  const [loupeIndex, setLoupeIndex] = useState<number | null>(null);
  const [minRating, setMinRating] = useState(0);
  // Preview-only, persists across images and loupe sessions; `r` resets.
  const [exposure, setExposure] = useState(0);
  const [filmstrip, setFilmstrip] = useState<FilmstripMode>(() => {
    const stored = localStorage.getItem("photopipe.filmstrip");
    if (stored === "0") return "off"; // migrate the old boolean
    if (stored === "off" || stored === "thumbs" || stored === "ratings")
      return stored;
    return "thumbs";
  });
  const changeFilmstrip = (mode: FilmstripMode) => {
    setFilmstrip(mode);
    localStorage.setItem("photopipe.filmstrip", mode);
  };

  const connectRoot = useCallback(async (path: string) => {
    setRootState({ kind: "picking", error: null, busy: true });
    try {
      const result = await coreRequest<SetRootResult>("setRoot", { path });
      localStorage.setItem(ROOT_KEY, path);
      rememberRoot(path);
      setRootState({ kind: "ready", path, generation: result.generation });
    } catch (error) {
      localStorage.removeItem(ROOT_KEY);
      setRootState({ kind: "picking", error: String(error), busy: false });
    }
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem(ROOT_KEY);
    if (stored) connectRoot(stored);
  }, [connectRoot]);

  const ready = rootState.kind === "ready";
  const shoots = useShoots(ready);
  const images = useImages(openShoot);
  const setRating = useSetRating(openShoot);
  useGenerationPoll(ready, ready ? rootState.generation : null);

  const filteredImages = useMemo(
    () =>
      minRating === 0
        ? (images.data ?? [])
        : (images.data ?? []).filter((image) => image.rating >= minRating),
    [images.data, minRating],
  );

  // Rating with a filter active can shrink the list under the loupe.
  useEffect(() => {
    if (loupeIndex === null) return;
    if (filteredImages.length === 0) setLoupeIndex(null);
    else if (loupeIndex >= filteredImages.length)
      setLoupeIndex(filteredImages.length - 1);
  }, [loupeIndex, filteredImages.length]);

  const enterShoot = (shoot: string | null) => {
    setOpenShoot(shoot);
    setLoupeIndex(null);
    setMinRating(0);
  };

  if (!ready) {
    return (
      <RootPicker
        error={rootState.error}
        busy={rootState.busy}
        onSubmit={connectRoot}
      />
    );
  }

  const currentShoot = shoots.data?.find((s) => s.name === openShoot);
  const clampedLoupe =
    loupeIndex !== null && filteredImages.length > 0
      ? Math.min(loupeIndex, filteredImages.length - 1)
      : null;
  const loupeImage =
    clampedLoupe !== null ? filteredImages[clampedLoupe] : null;
  const inLoupe = openShoot !== null && loupeImage !== null;

  return (
    <TooltipProvider>
      <SidebarProvider>
        {inLoupe && loupeImage && clampedLoupe !== null ? (
          <LoupeSidebar
            image={loupeImage}
            position={clampedLoupe + 1}
            count={filteredImages.length}
            exposure={exposure}
            filmstrip={filmstrip}
            onFilmstrip={changeFilmstrip}
            onExposureChange={setExposure}
            onRate={(stem, rating) => setRating.mutate({ stem, rating })}
            onBackToGrid={() => setLoupeIndex(null)}
          />
        ) : (
          <AppSidebar
            shoots={shoots.data}
            openShoot={openShoot}
            onOpenShoot={enterShoot}
            minRating={minRating}
            onMinRating={setMinRating}
            filterEnabled={openShoot !== null}
            rootPath={rootState.path}
            onChangeRoot={() =>
              setRootState({ kind: "picking", error: null, busy: false })
            }
          />
        )}
        <SidebarInset className="flex h-screen min-w-0 flex-col bg-background text-foreground">
          <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-2 text-sm">
            <SidebarTrigger className="text-muted-foreground" />
            {openShoot ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid="back"
                  onClick={() => enterShoot(null)}
                  className="text-muted-foreground"
                >
                  <ChevronLeft />
                  Library
                </Button>
                <span className="truncate font-medium">{openShoot}</span>
                {currentShoot && <StageCounts counts={currentShoot.counts} />}
              </>
            ) : (
              <span className="text-muted-foreground">Library</span>
            )}
          </header>
          <div className="min-h-0 flex-1">
            {openShoot ? (
              inLoupe && clampedLoupe !== null ? (
                <Loupe
                  images={filteredImages}
                  index={clampedLoupe}
                  exposure={exposure}
                  filmstrip={filmstrip}
                  onExposureChange={setExposure}
                  onNavigate={setLoupeIndex}
                  onClose={() => setLoupeIndex(null)}
                  onRate={(stem, rating) => setRating.mutate({ stem, rating })}
                />
              ) : images.data ? (
                <ImageGrid images={filteredImages} onOpen={setLoupeIndex} />
              ) : (
                <p className="p-8 text-sm text-muted-foreground">loading…</p>
              )
            ) : shoots.data ? (
              <div className="h-full overflow-auto">
                <Dashboard shoots={shoots.data} onOpen={enterShoot} />
              </div>
            ) : (
              <p className="p-8 text-sm text-muted-foreground">
                scanning library…
              </p>
            )}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
