import { open as openDialog, save } from "@tauri-apps/plugin-dialog";
import { Download } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import { BrowserToolbar, type ViewMode } from "@/components/BrowserToolbar";
import { Dashboard } from "@/components/Dashboard";
import type { FilmstripMode } from "@/components/Filmstrip";
import { ImageGrid } from "@/components/ImageGrid";
import { ImageList, type ListInfo } from "@/components/ImageList";
import { Loupe } from "@/components/Loupe";
import { LoupeSidebar } from "@/components/LoupeSidebar";
import { NewProjectDialog } from "@/components/NewProjectDialog";
import { PAGES, type Page, PageNav } from "@/components/PageNav";
import { matchesRatingFilter, type RatingOp } from "@/components/RatingFilter";
import { RootPicker, rememberRoot } from "@/components/RootPicker";
import { SelectionBar } from "@/components/SelectionBar";
import { SettingsDialog } from "@/components/SettingsDialog";
import { ShootSettingsDialog } from "@/components/ShootSettingsDialog";
import { Button } from "@/components/ui/button";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  coreRequest,
  type ImageGroup,
  type SetRootResult,
  type Stage,
} from "@/lib/core";
import {
  useExportFiles,
  useGenerationPoll,
  useImages,
  useImportFiles,
  useOpenIn,
  useReveal,
  useSetRating,
  useShoots,
  useTrash,
} from "@/lib/queries";
import { useSelection } from "@/lib/selection";
import { appName, processingEnabled, useSettings } from "@/lib/settings";

const ROOT_KEY = "photopipe.root";

type RootState =
  | { kind: "picking"; error: string | null; busy: boolean }
  | { kind: "ready"; path: string; generation: number };

/// What each stage page is waiting for, and which file it sends out. A
/// denoiser wants the raw; an editor wants the DNG if one came back.
const STAGE_PAGES: Record<
  "edit" | "export",
  {
    produces: Stage;
    sends: Stage[];
    empty: string;
    purpose: string;
  }
> = {
  edit: {
    produces: "denoised",
    sends: ["denoised"],
    empty:
      "Nothing to edit yet. Send originals from Media to your denoiser, or import DNGs here.",
    purpose:
      "Back from the denoiser. Open in your editor; finished exports land in Export.",
  },
  export: {
    produces: "export",
    sends: ["export"],
    empty: "Nothing exported yet. Finished files show up here.",
    purpose: "Deliver: finished exports, ready to zip for hand-over.",
  },
};

/// Page copy depends on whether a denoise step exists at all.
function purposeFor(page: Page, processing: boolean): string {
  if (page === "media") {
    return processing
      ? "Your originals. Rate and cull, then send keepers to your denoiser."
      : "Your originals. Rate and cull, then open keepers in your editor.";
  }
  if (page === "edit" && !processing) {
    return "Your working set. Open in your editor; finished exports land in Export.";
  }
  return STAGE_PAGES[page as "edit" | "export"].purpose;
}

function emptyFor(page: Page, processing: boolean): string {
  if (page === "media") {
    return "No photos in this project yet. Import them here or drop files into the original/ folder.";
  }
  if (page === "edit" && !processing) {
    return "No photos to edit yet. Import them on Media first.";
  }
  return STAGE_PAGES[page as "edit" | "export"].empty;
}

const VIEW_KEY = (page: Page) => `photopipe.view.${page}`;

export default function App() {
  const [rootState, setRootState] = useState<RootState>({
    kind: "picking",
    error: null,
    busy: false,
  });
  const [page, setPageRaw] = useState<Page>("media");
  const [openShoot, setOpenShoot] = useState<string | null>(null);
  const [newProject, setNewProject] = useState(false);
  const [appSettings, setAppSettings] = useState(false);
  const [shootSettings, setShootSettings] = useState<string | null>(null);
  const { settings, save: saveSettings } = useSettings();
  const processing = processingEnabled(settings);
  const setPage = useCallback((next: Page) => {
    setPageRaw(next);
  }, []);
  const [views, setViews] = useState<Record<Page, ViewMode>>(
    () =>
      Object.fromEntries(
        PAGES.map((name) => {
          const stored = localStorage.getItem(VIEW_KEY(name));
          const fallback: ViewMode = name === "media" ? "grid" : "list";
          return [
            name,
            stored === "grid" || stored === "list" ? stored : fallback,
          ];
        }),
      ) as Record<Page, ViewMode>,
  );
  const changeView = (name: Page, view: ViewMode) => {
    setViews((current) => ({ ...current, [name]: view }));
    localStorage.setItem(VIEW_KEY(name), view);
  };
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
  const openIn = useOpenIn();
  const reveal = useReveal();
  const trash = useTrash(openShoot);
  const exportFiles = useExportFiles();
  const importFiles = useImportFiles(openShoot);
  useGenerationPoll(ready, ready ? rootState.generation : null);

  const filteredImages = useMemo(
    () =>
      (images.data ?? []).filter((image) =>
        matchesRatingFilter(image.rating, ratingOp, ratingStars),
      ),
    [images.data, ratingOp, ratingStars],
  );

  // The Export page only concerns finished files; the other stages show the
  // whole project so you can see what's still missing.
  const pageImages = useMemo(() => {
    // Media is the original/ stage: images that have an original capture
    // (ARW — or JPEG for a JPEG-first shoot). Derived-only groups (an
    // orphan DNG from a renaming tool) belong to the later pages.
    if (page === "media") {
      return filteredImages.filter((image) =>
        image.files.some((file) => file.stage === "raw"),
      );
    }
    // Stage pages are folder views: empty until files land at that stage.
    // Without a denoise step nothing ever reaches processed/, so Edit works
    // from the originals instead of sitting permanently empty.
    const atStage =
      page === "edit" && !processing ? "raw" : STAGE_PAGES[page].produces;
    return (images.data ?? []).filter((image) =>
      image.files.some((file) => file.stage === atStage),
    );
  }, [page, filteredImages, images.data, processing]);

  const orderedStems = useMemo(
    () => pageImages.map((image) => image.stem),
    [pageImages],
  );
  const selection = useSelection(orderedStems);

  const selectedImages = useMemo(
    () => pageImages.filter((image) => selection.selected.has(image.stem)),
    [pageImages, selection.selected],
  );

  /// Which file of each selected image this page sends out.
  const selectedPaths = useMemo(() => {
    const stages =
      page === "media" ? null : STAGE_PAGES[page as "edit" | "export"].sends;
    return selectedImages.flatMap((image) => {
      if (!stages) return image.files.map((file) => file.path);
      for (const stage of stages) {
        const match = image.files.find((file) => file.stage === stage);
        if (match) return [match.path];
      }
      return [];
    });
  }, [selectedImages, page]);

  /// Tab badges: how many images sit at each stage. Zero stays hidden, so a
  /// fresh project shows nothing in Process and Edit until files land there.
  const badges = useMemo(() => {
    if (!openShoot) return {};
    const all = images.data ?? [];
    const at = (stage: Stage) =>
      all.filter((image) => image.files.some((file) => file.stage === stage))
        .length;
    return {
      edit: at("denoised"),
      export: at("export"),
    };
  }, [openShoot, images.data]);

  /// Which tool this page hands off to. With processing switched off there
  /// is no denoiser, so Media hands straight to the editor.
  const handoffApp = (target: Page): string | null =>
    target === "media" && processing ? settings.processor : settings.editor;

  const handoff = async (
    paths: string[] = selectedPaths,
    target: Page = page,
  ) => {
    // Guard against a caller wiring this straight to onClick: a DOM event
    // would arrive here as `paths` and reach JSON.stringify as a cycle.
    const files = Array.isArray(paths) ? paths : selectedPaths;
    let app = handoffApp(target);
    if (!app) {
      // Nothing configured yet: pick it here, then remember it app-wide.
      const chosen = await openDialog({
        title: "Choose an application",
        directory: false,
        filters: [{ name: "Applications", extensions: ["app"] }],
        defaultPath: "/Applications",
      }).catch(() => null);
      if (typeof chosen !== "string") return;
      app = chosen;
      saveSettings(
        target === "media" && processing
          ? { ...settings, processor: app }
          : { ...settings, editor: app },
      );
    }
    openIn.mutate({ paths: files, app, label: appName(app) ?? undefined });
  };

  const runExport = async () => {
    // Several files want a folder; a single one may as well be a zip too, so
    // the folder is the honest default either way.
    const destination = await openDialog({
      title: "Export to folder",
      directory: true,
    }).catch(() => null);
    if (typeof destination !== "string") return;
    exportFiles.mutate({ paths: selectedPaths, destination, zip: false });
  };

  const runZip = async () => {
    const destination = await save({
      title: "Save zip",
      defaultPath: `${openShoot ?? "export"}.zip`,
      filters: [{ name: "Zip archive", extensions: ["zip"] }],
    }).catch(() => null);
    if (typeof destination !== "string") return;
    exportFiles.mutate({ paths: selectedPaths, destination, zip: true });
  };

  /// Each page imports into its own stage folder: originals on Media,
  /// DNGs coming back on Process, finished files on Edit and Export.
  const importStage: Stage =
    page === "media" ? "raw" : STAGE_PAGES[page].produces;
  const runImport = async () => {
    const chosen = await openDialog({
      title: "Import photos",
      multiple: true,
      filters: [
        { name: "Photos", extensions: ["arw", "dng", "jpg", "jpeg", "png"] },
      ],
    }).catch(() => null);
    const paths = Array.isArray(chosen)
      ? chosen
      : typeof chosen === "string"
        ? [chosen]
        : [];
    if (paths.length === 0) return;
    importFiles.mutate({ stage: importStage, paths });
  };

  /// The always-visible next step. Empty selection: the button *starts* the
  /// step (arming select mode, or preselecting the waiting work). With a
  /// selection it becomes the action itself — the action is the transition.
  const cta = (() => {
    if (!openShoot || !images.data) return null;
    const count = selection.selected.size;
    // Empty: one click selects everything the page (and filter) shows.
    if (count === 0) {
      return {
        label: `Select all ${pageImages.length}`,
        disabled: pageImages.length === 0,
        onClick: selection.selectAll,
      };
    }
    // With a selection the button is the hand-off itself: Media sends raws
    // to the denoiser, Process sends DNGs to the editor, Edit walks on to
    // Export, Export zips.
    switch (page) {
      case "media": {
        // With processing on, originals go to the denoiser; with it off they
        // go straight to the editor, because there is no denoise step.
        const target = appName(handoffApp("media"));
        return {
          label: processing
            ? `Send ${count} to ${target ?? "denoiser"}`
            : `Open ${count} in ${target ?? "editor"}`,
          onClick: () =>
            handoff(
              selectedImages.flatMap((image) =>
                image.files
                  .filter((file) => file.stage === "raw")
                  .map((file) => file.path),
              ),
            ),
        };
      }
      case "edit":
        return {
          label: `Open ${count} in ${appName(settings.editor) ?? "editor"}`,
          onClick: () => handoff(),
        };
      case "export":
        return { label: `Export ${count}`, onClick: runZip };
    }
  })();

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

  useEffect(() => {
    if (loupeStem && loupeIndex === -1) setLoupeStem(null);
  }, [loupeStem, loupeIndex]);

  // ⌘1–⌘4 switch workspace; ⌘A selects everything on the page; Esc clears.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey) {
        const index = Number(event.key) - 1;
        if (PAGES[index]) {
          event.preventDefault();
          setPage(PAGES[index]);
          return;
        }
        if (event.key === "a" && loupeIndex === -1) {
          event.preventDefault();
          selection.selectAll();
        }
        return;
      }
      if (event.key === "Escape" && loupeIndex === -1 && !selection.isEmpty) {
        selection.clear();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selection, loupeIndex, setPage]);

  const changeRatingStars = (stars: number) => {
    setRatingStars(stars);
    if (stars > 0 && ratingOp === "unrated") setRatingOp("gte");
  };

  const enterShoot = (shoot: string | null) => {
    setOpenShoot(shoot);
    setLoupeStem(null);
    setRatingStars(0); // comparator choice sticks; the threshold resets
    selection.clear();
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

  const loupeImage = loupeIndex >= 0 ? loupeImages[loupeIndex] : null;
  const inLoupe = page === "media" && openShoot !== null && loupeImage !== null;

  return (
    <TooltipProvider>
      <SettingsDialog open={appSettings} onOpenChange={setAppSettings} />
      <ShootSettingsDialog
        open={shootSettings !== null}
        onOpenChange={(next) => !next && setShootSettings(null)}
        shoot={shoots.data?.find((s) => s.name === shootSettings)}
        onRenamed={(renamed) => {
          // The folder moved, so anything holding the old name must follow.
          setShootSettings(null);
          if (openShoot === shootSettings) setOpenShoot(renamed);
        }}
      />
      <NewProjectDialog
        open={newProject}
        onOpenChange={setNewProject}
        onCreated={enterShoot}
      />
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
            currentShoot={shoots.data?.find((s) => s.name === openShoot)}
            onBack={() => enterShoot(null)}
            onImport={runImport}
            onRevealShoot={(path) => reveal.mutate([path])}
            onShootSettings={() => setShootSettings(openShoot)}
            onAppSettings={() => setAppSettings(true)}
            ratingOp={ratingOp}
            onRatingOp={setRatingOp}
            ratingStars={ratingStars}
            onRatingStars={changeRatingStars}
            filterEnabled={openShoot !== null && page === "media"}
            showInfo={showInfo}
            onShowInfo={toggleShowInfo}
            rootPath={rootState.path}
            onChangeRoot={() =>
              setRootState({ kind: "picking", error: null, busy: false })
            }
          />
        )}
        <SidebarInset className="flex h-screen min-w-0 flex-col bg-background text-foreground">
          {/* Navigation only — everything informational lives in the sidebar. */}
          <header className="flex h-10 shrink-0 items-center border-b border-border px-2">
            <PageNav page={page} onPage={setPage} badges={badges} />
          </header>
          <SelectionBar
            count={selection.selected.size}
            appLabel={
              handoffApp(page)
                ?.split("/")
                .pop()
                ?.replace(/\.app$/, "") ?? null
            }
            busy={openIn.isPending || exportFiles.isPending}
            onOpenIn={handoff}
            onExport={page === "export" ? runZip : runExport}
            onReveal={() => reveal.mutate(selectedPaths)}
            onDelete={() => trash.mutate([...selection.selected])}
            onClear={selection.clear}
          />
          <div className="min-h-0 flex-1">
            <PageContent
              page={page}
              openShoot={openShoot}
              images={images.data}
              pageImages={pageImages}
              shoots={shoots.data}
              onOpenShoot={enterShoot}
              onNewProject={() => setNewProject(true)}
              view={views[page]}
              onView={(view) => changeView(page, view)}
              cta={cta}
              onImport={runImport}
              processing={processing}
              onShootSettings={setShootSettings}
              inLoupe={inLoupe}
              loupeImages={loupeImages}
              loupeIndex={loupeIndex}
              exposure={exposure}
              filmstrip={filmstrip}
              showInfo={showInfo}
              selection={selection}
              onExposureChange={setExposure}
              onNavigate={(next) =>
                setLoupeStem(loupeImages[next]?.stem ?? null)
              }
              onCloseLoupe={() => setLoupeStem(null)}
              onRate={(stem, rating) => setRating.mutate({ stem, rating })}
              onOpenLoupe={(index) =>
                setLoupeStem(pageImages[index]?.stem ?? null)
              }
            />
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}

type ContentProps = {
  page: Page;
  openShoot: string | null;
  images: ImageGroup[] | undefined;
  pageImages: ImageGroup[];
  shoots: ReturnType<typeof useShoots>["data"];
  onOpenShoot: (shoot: string) => void;
  onNewProject: () => void;
  view: ViewMode;
  onView: (view: ViewMode) => void;
  cta: { label: string; disabled?: boolean; onClick: () => void } | null;
  onImport: () => void;
  processing: boolean;
  onShootSettings: (shoot: string) => void;
  inLoupe: boolean;
  loupeImages: ImageGroup[];
  loupeIndex: number;
  exposure: number;
  filmstrip: FilmstripMode;
  showInfo: boolean;
  selection: ReturnType<typeof useSelection>;
  onExposureChange: (ev: number) => void;
  onNavigate: (index: number) => void;
  onCloseLoupe: () => void;
  onRate: (stem: string, rating: number) => void;
  onOpenLoupe: (index: number) => void;
};

function PageContent({
  page,
  openShoot,
  images,
  pageImages,
  shoots,
  onOpenShoot,
  onNewProject,
  view,
  onView,
  cta,
  onImport,
  processing,
  onShootSettings,
  inLoupe,
  loupeImages,
  loupeIndex,
  exposure,
  filmstrip,
  showInfo,
  selection,
  onExposureChange,
  onNavigate,
  onCloseLoupe,
  onRate,
  onOpenLoupe,
}: ContentProps) {
  if (!openShoot) {
    // Without a project the pages have nothing to work on; Media doubles as
    // the library so there's always somewhere to go.
    if (page !== "media") {
      return (
        <p
          data-testid="no-project"
          className="p-8 text-sm text-muted-foreground"
        >
          Open a shoot to use {page}.
        </p>
      );
    }
    return shoots ? (
      <div className="h-full overflow-auto">
        <Dashboard
          shoots={shoots}
          onOpen={onOpenShoot}
          onNewProject={onNewProject}
          onSettings={onShootSettings}
        />
      </div>
    ) : (
      <p className="p-8 text-sm text-muted-foreground">scanning library…</p>
    );
  }

  if (!images) {
    return <p className="p-8 text-sm text-muted-foreground">loading…</p>;
  }

  if (inLoupe) {
    return (
      <Loupe
        images={loupeImages}
        index={loupeIndex}
        exposure={exposure}
        filmstrip={filmstrip}
        onExposureChange={onExposureChange}
        onNavigate={onNavigate}
        onClose={onCloseLoupe}
        onRate={onRate}
      />
    );
  }

  const selectMode = !selection.isEmpty;
  const media = page === "media";
  const emptyMessage = emptyFor(page, processing);
  if (pageImages.length === 0) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <BrowserToolbar
          purpose={purposeFor(page, processing)}
          view={view}
          onView={onView}
          cta={null}
        />
        <div className="flex flex-col items-start gap-3 p-8">
          <p
            data-testid="stage-empty"
            className="text-muted-foreground text-sm"
          >
            {emptyMessage}
          </p>
          <Button size="sm" data-testid="empty-import" onClick={onImport}>
            <Download />
            Import photos
          </Button>
        </div>
      </div>
    );
  }
  const listInfo: ListInfo = media
    ? { kind: "media" }
    : {
        kind: "stage",
        produces: "export",
        label: "Edited",
      };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <BrowserToolbar
        purpose={purposeFor(page, processing)}
        view={view}
        onView={onView}
        cta={cta}
      />
      <div className="min-h-0 flex-1">
        {view === "grid" ? (
          <ImageGrid
            images={pageImages}
            onOpen={media ? onOpenLoupe : undefined}
            showInfo={showInfo}
            selected={selection.selected}
            selectMode={selectMode || !media}
            displayOriginal={media}
            onSelect={selection.click}
          />
        ) : (
          <ImageList
            images={pageImages}
            info={listInfo}
            selected={selection.selected}
            selectMode={selectMode}
            onSelect={selection.click}
            onOpen={media ? onOpenLoupe : undefined}
            displayOriginal={media}
            emptyMessage={emptyMessage}
          />
        )}
      </div>
    </div>
  );
}
