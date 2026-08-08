import { useCallback, useEffect, useMemo, useState } from "react";
import { Dashboard, StageCounts } from "@/components/Dashboard";
import { ImageGrid } from "@/components/ImageGrid";
import { Loupe } from "@/components/Loupe";
import { Photopipe } from "@/components/Photopipe";
import { RootPicker } from "@/components/RootPicker";
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

  const connectRoot = useCallback(async (path: string) => {
    setRootState({ kind: "picking", error: null, busy: true });
    try {
      const result = await coreRequest<SetRootResult>("setRoot", { path });
      localStorage.setItem(ROOT_KEY, path);
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

  return (
    <main className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex items-center gap-3 border-b border-border px-4 py-2 text-sm">
        {openShoot ? (
          <>
            <button
              type="button"
              data-testid="back"
              onClick={() => enterShoot(null)}
              className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              ← Library
            </button>
            <span className="font-medium">{openShoot}</span>
            {currentShoot && <StageCounts counts={currentShoot.counts} />}
            <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
              filter
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  data-testid={`filter-${star}`}
                  onClick={() =>
                    setMinRating((current) => (current === star ? 0 : star))
                  }
                  className={`rounded px-1 py-0.5 transition-colors hover:text-amber-300 ${
                    minRating >= star
                      ? "text-amber-400"
                      : "text-muted-foreground/50"
                  }`}
                >
                  ★
                </button>
              ))}
            </span>
          </>
        ) : (
          <>
            <span className="flex items-center gap-2">
              <Photopipe className="h-5 w-5" />
              <span className="font-heading font-semibold tracking-tight">
                Photopipe
              </span>
            </span>
            <span className="truncate font-mono text-xs text-muted-foreground">
              {rootState.path}
            </span>
            <button
              type="button"
              data-testid="change-root"
              onClick={() =>
                setRootState({ kind: "picking", error: null, busy: false })
              }
              className="ml-auto rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              change
            </button>
          </>
        )}
      </header>
      <div className="min-h-0 flex-1">
        {openShoot ? (
          images.data ? (
            <ImageGrid images={filteredImages} onOpen={setLoupeIndex} />
          ) : (
            <p className="p-8 text-sm text-muted-foreground">loading…</p>
          )
        ) : shoots.data ? (
          <div className="h-full overflow-auto">
            <Dashboard shoots={shoots.data} onOpen={enterShoot} />
          </div>
        ) : (
          <p className="p-8 text-sm text-muted-foreground">scanning library…</p>
        )}
      </div>
      {loupeIndex !== null && filteredImages.length > 0 && (
        <Loupe
          images={filteredImages}
          index={Math.min(loupeIndex, filteredImages.length - 1)}
          onNavigate={setLoupeIndex}
          onClose={() => setLoupeIndex(null)}
          onRate={(stem, rating) => setRating.mutate({ stem, rating })}
        />
      )}
    </main>
  );
}
