import { ChevronLeft } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import { Dashboard, StageCounts } from "@/components/Dashboard";
import type { FilmstripMode } from "@/components/Filmstrip";
import { ImageGrid } from "@/components/ImageGrid";
import { Loupe } from "@/components/Loupe";
import { LoupeSidebar } from "@/components/LoupeSidebar";
import { matchesRatingFilter, type RatingOp } from "@/components/RatingFilter";
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
  const [loupeStem, setLoupeStem] = useState<string | null>(null);
  const [ratingOp, setRatingOp] = useState<RatingOp>("gte");
  const [ratingStars, setRatingStars] = useState(0);
  const [showInfo, setShowInfo] = useState(
    () => localStorage.getItem("photopipe.gridInfo") === "always",
  );
  const toggleShowInfo = (show: boolean) => {
    setShowInfo(show);
    localStorage.setItem("photopipe.gridInfo", show ? "always" : "hover");
  };
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
      (images.data ?? []).filter((image) =>
        matchesRatingFilter(image.rating, ratingOp, ratingStars),
      ),
    [images.data, ratingOp, ratingStars],
  );

  // The loupe navigates the filtered matches — plus the current image
  // pinned in its original position when it stops matching. Changing the
  // filter (or rating the current image below it) must never eject the
  // loupe back to the grid; the pin dissolves on navigation.
  const loupeImages = useMemo(() => {
    if (!loupeStem) return filteredImages;
    if (filteredImages.some((image) => image.stem === loupeStem)) {
      return filteredImages;
    }
    const all = images.data ?? [];
    const position = new Map(all.map((image, i) => [image.stem, i]));
    const pinnedAt = position.get(loupeStem);
    if (pinnedAt === undefined) return filteredImages;
    const result = [...filteredImages];
    const insertAt = result.findIndex(
      (image) => (position.get(image.stem) ?? -1) > pinnedAt,
    );
    if (insertAt === -1) result.push(all[pinnedAt]);
    else result.splice(insertAt, 0, all[pinnedAt]);
    return result;
  }, [filteredImages, images.data, loupeStem]);

  const loupeIndex = loupeStem
    ? loupeImages.findIndex((image) => image.stem === loupeStem)
    : -1;

  // A pinned image that vanishes entirely (external delete → rescan) drops
  // the loupe to the grid; the stem must go with it, or the loupe would
  // spontaneously reopen if the file ever reappears.
  useEffect(() => {
    if (loupeStem && loupeIndex === -1) setLoupeStem(null);
  }, [loupeStem, loupeIndex]);

  // Picking a star while in unrated mode means "back to threshold mode".
  const changeRatingStars = (stars: number) => {
    setRatingStars(stars);
    if (stars > 0 && ratingOp === "unrated") setRatingOp("gte");
  };

  const enterShoot = (shoot: string | null) => {
    setOpenShoot(shoot);
    setLoupeStem(null);
    setRatingStars(0); // comparator choice sticks; the threshold resets
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
  const loupeImage = loupeIndex >= 0 ? loupeImages[loupeIndex] : null;
  const inLoupe = openShoot !== null && loupeImage !== null;

  return (
    <TooltipProvider>
      <SidebarProvider>
        {inLoupe && loupeImage ? (
          <LoupeSidebar
            image={loupeImage}
            position={loupeIndex + 1}
            count={loupeImages.length}
            exposure={exposure}
            filmstrip={filmstrip}
            onFilmstrip={changeFilmstrip}
            ratingOp={ratingOp}
            onRatingOp={setRatingOp}
            ratingStars={ratingStars}
            onRatingStars={changeRatingStars}
            onExposureChange={setExposure}
            onRate={(stem, rating) => setRating.mutate({ stem, rating })}
            onBackToGrid={() => setLoupeStem(null)}
          />
        ) : (
          <AppSidebar
            shoots={shoots.data}
            openShoot={openShoot}
            onOpenShoot={enterShoot}
            ratingOp={ratingOp}
            onRatingOp={setRatingOp}
            ratingStars={ratingStars}
            onRatingStars={changeRatingStars}
            filterEnabled={openShoot !== null}
            showInfo={showInfo}
            onShowInfo={toggleShowInfo}
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
              inLoupe ? (
                <Loupe
                  images={loupeImages}
                  index={loupeIndex}
                  exposure={exposure}
                  filmstrip={filmstrip}
                  onExposureChange={setExposure}
                  onNavigate={(next) =>
                    setLoupeStem(loupeImages[next]?.stem ?? null)
                  }
                  onClose={() => setLoupeStem(null)}
                  onRate={(stem, rating) => setRating.mutate({ stem, rating })}
                />
              ) : images.data ? (
                <ImageGrid
                  images={filteredImages}
                  onOpen={(index) =>
                    setLoupeStem(filteredImages[index]?.stem ?? null)
                  }
                  showInfo={showInfo}
                />
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
