import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  AlertCircle,
  Check,
  Download,
  SlidersHorizontal,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AppSidebar } from "@/components/AppSidebar";
import { BrowserToolbar, type ViewMode } from "@/components/BrowserToolbar";
import {
  type CropDraft,
  commitDraft,
  draftFromEdit,
} from "@/components/CropTool";
import { Dashboard } from "@/components/Dashboard";
import { EditSidebar } from "@/components/EditPanel";
import {
  ExportDrawer,
  type ExportJob,
  type ExportOptions,
} from "@/components/ExportDrawer";
import type { FilmstripMode } from "@/components/Filmstrip";
import { ImageGrid } from "@/components/ImageGrid";
import { ImageList } from "@/components/ImageList";
import { IndexingStatus } from "@/components/IndexingStatus";
import { Loupe } from "@/components/Loupe";
import { LoupeSidebar } from "@/components/LoupeSidebar";
import { NewProjectDialog } from "@/components/NewProjectDialog";
import {
  matchesRatingFilter,
  type RatingOp,
  ratingCounts,
} from "@/components/RatingFilter";
import { RootPicker, rememberRoot } from "@/components/RootPicker";
import { SelectionBar } from "@/components/SelectionBar";
import { SettingsDialog } from "@/components/SettingsDialog";
import { ShootSettingsDialog } from "@/components/ShootSettingsDialog";
import { Button } from "@/components/ui/button";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  coreRequest,
  type Edit,
  type ImageFile,
  identityEdit,
  isIdentityEdit,
  type SetRootResult,
} from "@/lib/core";
import { betterThan, scoreRanks } from "@/lib/instinct";
import {
  type ScoreProgress,
  useExportFiles,
  useImages,
  useImportFiles,
  useLibrarySync,
  useReveal,
  useScoring,
  useSetEdit,
  useSetRating,
  useShoots,
  useTrash,
} from "@/lib/queries";
import { useSelection } from "@/lib/selection";
import { type SortKey, sortImages } from "@/lib/sort";
import { useDebouncedEdit } from "@/lib/useDebouncedEdit";
import { useUpdater } from "@/lib/useUpdater";

const ROOT_KEY = "photopipe.root";
const VIEW_KEY = "photopipe.view";
const EDIT_PANEL_KEY = "photopipe.editPanel";
const SORT_KEY = "photopipe.sort";
const AUTO_SCORE_KEY = "photopipe.autoScore";
/// One toast id for the whole update conversation, so a download replaces the
/// offer rather than stacking under it.
const UPDATE_TOAST = "update";

type RootState =
  | { kind: "picking"; error: string | null; busy: boolean }
  | { kind: "ready"; path: string; generation: number };

const EDIT_COMMIT_MS = 400;

export default function App() {
  const [rootState, setRootState] = useState<RootState>({
    kind: "picking",
    error: null,
    busy: false,
  });
  const [openShoot, setOpenShoot] = useState<string | null>(null);
  const [newProject, setNewProject] = useState(false);
  const [shootSettings, setShootSettings] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const updater = useUpdater();
  const [view, setView] = useState<ViewMode>(() =>
    localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid",
  );
  const changeView = (next: ViewMode) => {
    setView(next);
    localStorage.setItem(VIEW_KEY, next);
  };
  const [sort, setSort] = useState<SortKey>(() => {
    const stored = localStorage.getItem(SORT_KEY);
    return stored === "date" || stored === "score" ? stored : "name";
  });
  const changeSort = (next: SortKey) => {
    setSort(next);
    localStorage.setItem(SORT_KEY, next);
  };
  const [autoScore, setAutoScore] = useState(
    () => localStorage.getItem(AUTO_SCORE_KEY) !== "off",
  );
  const changeAutoScore = (on: boolean) => {
    setAutoScore(on);
    localStorage.setItem(AUTO_SCORE_KEY, on ? "on" : "off");
  };
  // outlives the loupe, so closing it lands the browser on the same photo
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [loupeOpen, setLoupeOpen] = useState(false);
  const [ratingOp, setRatingOp] = useState<RatingOp>("gte");
  const [ratingStars, setRatingStars] = useState(0);
  const [showInfo, setShowInfo] = useState(
    () => localStorage.getItem("photopipe.gridInfo") === "always",
  );
  const toggleShowInfo = (show: boolean) => {
    setShowInfo(show);
    localStorage.setItem("photopipe.gridInfo", show ? "always" : "hover");
  };
  const [filmstrip, setFilmstrip] = useState<FilmstripMode>(() => {
    const stored = localStorage.getItem("photopipe.filmstrip");
    if (stored === "0") return "off";
    if (stored === "off" || stored === "thumbs" || stored === "ratings")
      return stored;
    return "thumbs";
  });
  const changeFilmstrip = (mode: FilmstripMode) => {
    setFilmstrip(mode);
    localStorage.setItem("photopipe.filmstrip", mode);
  };
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(
    () => localStorage.getItem(EDIT_PANEL_KEY) !== "hidden",
  );
  const toggleEditPanel = useCallback(() => {
    setEditOpen((open) => {
      localStorage.setItem(EDIT_PANEL_KEY, open ? "hidden" : "shown");
      return !open;
    });
  }, []);
  const [cropDraft, setCropDraft] = useState<CropDraft | null>(null);
  const cropping = cropDraft !== null;
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  const nextJobId = useRef(1);

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
  const { progress: scoring, justRated } = useScoring(
    openShoot,
    ready && autoScore,
  );
  const setRating = useSetRating(openShoot);
  const setEdit = useSetEdit(openShoot);
  const reveal = useReveal();
  const trash = useTrash(openShoot);
  const exportFiles = useExportFiles();
  const importFiles = useImportFiles(openShoot);
  const scan = useLibrarySync(ready, ready ? rootState.generation : null);

  const allImages = images.data ?? [];
  // A finished pass is the signal, not a score on every photo: the core counts
  // a file it cannot read as answered, and one of those would otherwise keep
  // Instinct greyed out for the whole project forever.
  const scoreReady = scoring
    ? scoring.total > 0 && !scoring.running && scoring.done >= scoring.total
    : allImages.length > 0 && allImages.every((image) => image.score != null);
  // Sorting a half-rated project would put photos in an order the scores do not
  // support, so until the pass is done the browser falls back to name.
  const activeSort = sort === "score" && !scoreReady ? "name" : sort;
  const filteredImages = useMemo(
    () =>
      sortImages(
        allImages.filter((image) =>
          matchesRatingFilter(image.rating, ratingOp, ratingStars),
        ),
        activeSort,
      ),
    [allImages, ratingOp, ratingStars, activeSort],
  );
  const ranks = useMemo(() => scoreRanks(allImages), [allImages]);
  const counts = useMemo(() => ratingCounts(allImages), [allImages]);
  const filterActive = ratingOp === "unrated" || ratingStars > 0;

  const orderedPaths = useMemo(
    () => filteredImages.map((image) => image.path),
    [filteredImages],
  );
  const selection = useSelection(orderedPaths);

  const selectedImages = useMemo(
    () => filteredImages.filter((image) => selection.selected.has(image.path)),
    [filteredImages, selection.selected],
  );
  const editedCount = useMemo(
    () => selectedImages.filter((image) => !isIdentityEdit(image.edit)).length,
    [selectedImages],
  );

  const {
    draft: editDraft,
    scrub: scrubEdit,
    flush: flushEdit,
  } = useDebouncedEdit(
    (path, edit) => setEdit.mutate({ path, edit }),
    EDIT_COMMIT_MS,
  );
  // Until the core has read what the file already carries, every edit here is
  // relative to a blank placeholder and would erase the real one. The keyboard
  // reaches this with the edit panel closed, so say why nothing happened.
  const changeEdit = (image: ImageFile, edit: Edit) => {
    if (!image.enriched) {
      toast("Still reading this photo's existing edits", { id: "not-indexed" });
      return;
    }
    scrubEdit(image.path, edit);
  };

  const installBlocked = jobs.some((job) => job.status === "running")
    ? "Finish the running export first; installing restarts Photopipe."
    : null;
  const { install: installUpdate } = updater;
  // Sonner dismisses the toast the moment Install is clicked, so anything that
  // stops the install has to say so itself or it happens in silence.
  const startInstall = useCallback(async () => {
    if (installBlocked) {
      toast.error(installBlocked, { id: UPDATE_TOAST });
      return;
    }
    flushEdit();
    const result = await installUpdate();
    if (result.kind === "error") {
      toast.error(`Install failed: ${result.message}`, { id: UPDATE_TOAST });
    }
  }, [installBlocked, flushEdit, installUpdate]);

  const offerUpdate = useCallback(
    (version: string, id?: string | number) => {
      toast(`Photopipe ${version} is available`, {
        id,
        duration: Number.POSITIVE_INFINITY,
        action: { label: "Install", onClick: () => void startInstall() },
      });
    },
    [startInstall],
  );

  const { state: updateState } = updater;
  const offered = useRef(false);
  useEffect(() => {
    if (updateState.kind === "downloading") {
      toast.loading(
        updateState.percent === null
          ? "Downloading update…"
          : `Downloading update… ${updateState.percent}%`,
        { id: UPDATE_TOAST, duration: Number.POSITIVE_INFINITY },
      );
      return;
    }
    if (updateState.kind === "installed") {
      toast.success("Update installed, restarting…", { id: UPDATE_TOAST });
      return;
    }
    if (updateState.kind !== "available" || offered.current) return;
    offered.current = true;
    offerUpdate(updateState.version);
  }, [updateState, offerUpdate]);

  const { check: checkUpdate } = updater;
  const checkForUpdates = useCallback(async () => {
    // The startup check offers on its own; this one owns the toast instead.
    offered.current = true;
    toast.loading("Checking for updates…", { id: UPDATE_TOAST });
    const result = await checkUpdate();
    if (result.kind === "available") offerUpdate(result.version, UPDATE_TOAST);
    else if (result.kind === "error")
      toast.error(result.message, { id: UPDATE_TOAST });
    else toast.success("Photopipe is up to date", { id: UPDATE_TOAST });
  }, [checkUpdate, offerUpdate]);

  // Subscribe once for the app's lifetime. Re-subscribing whenever the check
  // callback changes identity leaves gaps where a menu click reaches nobody.
  const latestCheck = useRef(checkForUpdates);
  useEffect(() => {
    latestCheck.current = checkForUpdates;
  }, [checkForUpdates]);

  useEffect(() => {
    const subscriptions = [
      listen("menu:settings", () => setSettingsOpen(true)),
      listen("menu:check-updates", () => void latestCheck.current()),
    ];
    for (const subscription of subscriptions) subscription.catch(() => {});
    return () => {
      for (const subscription of subscriptions) {
        void subscription.then((unlisten) => unlisten()).catch(() => {});
      }
    };
  }, []);

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
    importFiles.mutate(paths);
  };

  const runExport = (options: ExportOptions, destination: string) => {
    if (!openShoot) return;
    const id = nextJobId.current++;
    const label = `Export ${selectedImages.length} ${
      options.format === "jpeg" ? "as JPEG" : "originals"
    }`;
    setJobs((current) => [
      { id, label, destination, status: "running" as const },
      ...current,
    ]);
    exportFiles.mutate(
      {
        shoot: openShoot,
        paths: selectedImages.map((image) => image.path),
        destination,
        zip: options.zip,
        flatten: options.flatten,
        format: options.format,
        quality: options.quality,
      },
      {
        onSuccess: (result) => {
          setJobs((current) =>
            current.map((job) =>
              job.id === id
                ? { ...job, status: "done" as const, files: result.files }
                : job,
            ),
          );
        },
        onError: (error) => {
          setJobs((current) =>
            current.map((job) =>
              job.id === id
                ? { ...job, status: "failed" as const, detail: String(error) }
                : job,
            ),
          );
        },
      },
    );
  };

  const loupeImages = useMemo(() => {
    if (!currentPath) return filteredImages;
    if (filteredImages.some((image) => image.path === currentPath)) {
      return filteredImages;
    }
    const position = new Map(allImages.map((image, i) => [image.path, i]));
    const pinnedAt = position.get(currentPath);
    if (pinnedAt === undefined) return filteredImages;
    const result = [...filteredImages];
    const insertAt = result.findIndex(
      (image) => (position.get(image.path) ?? -1) > pinnedAt,
    );
    if (insertAt === -1) result.push(allImages[pinnedAt]);
    else result.splice(insertAt, 0, allImages[pinnedAt]);
    return result;
  }, [filteredImages, allImages, currentPath]);

  const loupeIndex = currentPath
    ? loupeImages.findIndex((image) => image.path === currentPath)
    : -1;

  // a filtered-out photo is not in the browser, so land on its neighbour
  const focusPath = useMemo(() => {
    const current = loupeImages[loupeIndex];
    if (!current) return null;
    if (filteredImages.includes(current)) return current.path;
    return (
      (loupeImages[loupeIndex + 1] ?? loupeImages[loupeIndex - 1])?.path ?? null
    );
  }, [loupeImages, loupeIndex, filteredImages]);

  useEffect(() => {
    if (currentPath && loupeIndex === -1) {
      setCurrentPath(null);
      setLoupeOpen(false);
    }
  }, [currentPath, loupeIndex]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: leave crop mode on any way out of this photo
  useEffect(() => setCropDraft(null), [currentPath, loupeOpen]);

  const openExport = useCallback(() => {
    const image = loupeOpen ? loupeImages[loupeIndex] : null;
    if (image) {
      setLoupeOpen(false);
      selection.select([image.path]);
      setDrawerOpen(true);
      return;
    }
    setDrawerOpen((open) => !open);
  }, [loupeOpen, loupeIndex, loupeImages, selection]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey) {
        if (event.key === "a" && !loupeOpen) {
          event.preventDefault();
          selection.selectAll();
        }
        if (event.key === "e" && openShoot && !cropping) {
          event.preventDefault();
          openExport();
        }
        return;
      }
      if (event.key === "Escape" && !loupeOpen && !selection.isEmpty) {
        selection.clear();
      }
      if (event.key === "e" && !event.altKey && loupeOpen && !cropping) {
        toggleEditPanel();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selection, loupeOpen, openShoot, cropping, openExport, toggleEditPanel]);

  const changeRatingStars = (stars: number) => {
    setRatingStars(stars);
    if (stars > 0 && ratingOp === "unrated") setRatingOp("gte");
  };

  const enterShoot = (shoot: string | null) => {
    flushEdit();
    setOpenShoot(shoot);
    setCurrentPath(null);
    setLoupeOpen(false);
    setRatingStars(0);
    selection.clear();
  };

  // Settings is reachable from the menu bar at any time, including before a
  // photos folder is picked, so it lives outside the browser chrome.
  const settingsDialog = (
    <SettingsDialog
      open={settingsOpen}
      onOpenChange={setSettingsOpen}
      autoScore={autoScore}
      onAutoScore={changeAutoScore}
      onCheckUpdates={checkForUpdates}
    />
  );

  if (!ready) {
    return (
      <>
        <RootPicker
          error={rootState.error}
          busy={rootState.busy}
          onSubmit={connectRoot}
        />
        {settingsDialog}
      </>
    );
  }

  const loupeImage = loupeIndex >= 0 ? loupeImages[loupeIndex] : null;
  const inLoupe = openShoot !== null && loupeOpen && loupeImage !== null;
  const loupeEdit =
    loupeImage === null
      ? identityEdit
      : editDraft?.path === loupeImage.path
        ? editDraft.edit
        : loupeImage.edit;

  const currentShoot = shoots.data?.find((s) => s.name === openShoot);
  const runningJobs = jobs.filter((job) => job.status === "running").length;
  const latestJob = jobs[0];

  const applyCrop = () => {
    if (!cropDraft || !loupeImage) return;
    changeEdit(loupeImage, { ...loupeEdit, ...commitDraft(cropDraft) });
    setCropDraft(null);
  };
  const cancelCrop = () => setCropDraft(null);

  return (
    <TooltipProvider>
      <ShootSettingsDialog
        open={shootSettings !== null}
        onOpenChange={(next) => !next && setShootSettings(null)}
        shoot={shoots.data?.find((s) => s.name === shootSettings)}
        onRenamed={(renamed) => {
          setShootSettings(null);
          if (openShoot === shootSettings) setOpenShoot(renamed);
        }}
      />
      <NewProjectDialog
        open={newProject}
        onOpenChange={setNewProject}
        onCreated={enterShoot}
      />
      {settingsDialog}
      <SidebarProvider>
        {inLoupe && loupeImage ? (
          <LoupeSidebar
            image={loupeImage}
            position={loupeIndex + 1}
            count={loupeImages.length}
            betterThan={betterThan(
              ranks.get(loupeImage.path) ?? null,
              ranks.size,
            )}
            filmstrip={filmstrip}
            onFilmstrip={changeFilmstrip}
            ratingCounts={counts}
            ratingOp={ratingOp}
            onRatingOp={setRatingOp}
            ratingStars={ratingStars}
            onRatingStars={changeRatingStars}
            onRate={(path, rating) => setRating.mutate({ path, rating })}
            onBackToGrid={() => (cropping ? cancelCrop() : setLoupeOpen(false))}
          />
        ) : (
          <AppSidebar
            currentShoot={currentShoot}
            onBack={() => enterShoot(null)}
            onImport={runImport}
            onRevealShoot={(path) => reveal.mutate([path])}
            onShootSettings={() => setShootSettings(openShoot)}
            ratingCounts={counts}
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
            onSettings={() => setSettingsOpen(true)}
          />
        )}
        <SidebarInset className="flex h-screen min-w-0 flex-col bg-background text-foreground">
          <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
            {currentShoot ? (
              <>
                <span className="truncate font-medium text-sm">
                  {currentShoot.project ?? currentShoot.name}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {currentShoot.imageCount} photos
                </span>
              </>
            ) : (
              <span className="text-muted-foreground text-sm">Library</span>
            )}
            <span className="flex-1" />
            <IndexingStatus progress={scan} />
            {jobs.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                data-testid="activity-pill"
                onClick={() => setDrawerOpen(true)}
                className="h-7 text-xs text-muted-foreground"
              >
                {runningJobs > 0 ? (
                  <>
                    <span className="size-2 animate-pulse rounded-full bg-primary" />
                    Exporting…
                  </>
                ) : latestJob?.status === "failed" ? (
                  <>
                    <AlertCircle className="text-destructive" />
                    Activity
                  </>
                ) : (
                  <>
                    <Check className="text-emerald-400" />
                    Activity
                  </>
                )}
              </Button>
            )}
            {inLoupe && (
              <Button
                size="sm"
                variant={editOpen ? "secondary" : "ghost"}
                data-testid="toggle-edit"
                onClick={toggleEditPanel}
                disabled={cropping}
                title={
                  cropping ? "Finish the crop first" : "Toggle edit panel (e)"
                }
                className="h-7 text-xs"
              >
                <SlidersHorizontal />
                Edit
              </Button>
            )}
            {openShoot && (
              <Button
                size="sm"
                data-testid="open-export"
                onClick={() => openExport()}
                title="Export (⌘E)"
                className="h-7 text-xs"
              >
                <Upload />
                Export
                {selection.selected.size > 0 && ` ${selection.selected.size}`}…
              </Button>
            )}
          </header>
          <SelectionBar
            count={selection.selected.size}
            busy={exportFiles.isPending}
            onExport={() => setDrawerOpen(true)}
            onReveal={() =>
              reveal.mutate(selectedImages.map((image) => image.path))
            }
            onDelete={() =>
              trash.mutate(selectedImages.map((image) => image.path))
            }
            onClear={selection.clear}
          />
          <div className="flex min-h-0 flex-1">
            <div className="min-w-0 flex-1">
              <Content
                openShoot={openShoot}
                loaded={images.data !== undefined}
                filteredImages={filteredImages}
                shoots={shoots.data}
                onOpenShoot={enterShoot}
                onNewProject={() => setNewProject(true)}
                view={view}
                onView={changeView}
                sort={activeSort}
                onSort={changeSort}
                scoreReady={scoreReady}
                scoring={scoring}
                justRated={justRated}
                onImport={runImport}
                onShootSettings={setShootSettings}
                filterActive={filterActive}
                focusPath={focusPath}
                inLoupe={inLoupe}
                loupeImages={loupeImages}
                loupeIndex={loupeIndex}
                loupeEdit={loupeEdit}
                cropDraft={cropDraft}
                onCropDraft={setCropDraft}
                onApplyCrop={applyCrop}
                onCancelCrop={cancelCrop}
                filmstrip={filmstrip}
                showInfo={showInfo}
                selection={selection}
                onEditChange={changeEdit}
                onNavigate={(next) =>
                  setCurrentPath(loupeImages[next]?.path ?? null)
                }
                onCloseLoupe={() => setLoupeOpen(false)}
                onRate={(path, rating) => setRating.mutate({ path, rating })}
                onOpenLoupe={(index) => {
                  setCurrentPath(filteredImages[index]?.path ?? null);
                  setLoupeOpen(true);
                }}
              />
            </div>
            {inLoupe && loupeImage && editOpen && (
              <EditSidebar
                image={loupeImage}
                edit={loupeEdit}
                onChange={(edit) => changeEdit(loupeImage, edit)}
                cropDraft={cropDraft}
                onCropDraft={setCropDraft}
                onEnterCrop={() => setCropDraft(draftFromEdit(loupeEdit))}
                onApplyCrop={applyCrop}
                onCancelCrop={cancelCrop}
                onClose={toggleEditPanel}
              />
            )}
            {drawerOpen && openShoot && !inLoupe && (
              <ExportDrawer
                shoot={openShoot}
                selectedCount={selection.selected.size}
                editedCount={editedCount}
                filteredCount={filteredImages.length}
                totalCount={allImages.length}
                filterActive={filterActive}
                jobs={jobs}
                busy={exportFiles.isPending}
                onSelectFiltered={() => selection.select(orderedPaths)}
                onSelectAll={() => {
                  setRatingStars(0);
                  if (ratingOp === "unrated") setRatingOp("gte");
                  selection.select(allImages.map((image) => image.path));
                }}
                onClearSelection={selection.clear}
                onExport={runExport}
                onReveal={(path) => reveal.mutate([path])}
                onClose={() => setDrawerOpen(false)}
              />
            )}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}

type ContentProps = {
  openShoot: string | null;
  loaded: boolean;
  filteredImages: ImageFile[];
  shoots: ReturnType<typeof useShoots>["data"];
  onOpenShoot: (shoot: string) => void;
  onNewProject: () => void;
  view: ViewMode;
  onView: (view: ViewMode) => void;
  sort: SortKey;
  onSort: (sort: SortKey) => void;
  scoreReady: boolean;
  scoring: ScoreProgress | null;
  justRated: boolean;
  onImport: () => void;
  onShootSettings: (shoot: string) => void;
  filterActive: boolean;
  focusPath: string | null;
  inLoupe: boolean;
  loupeImages: ImageFile[];
  loupeIndex: number;
  loupeEdit: Edit;
  cropDraft: CropDraft | null;
  onCropDraft: (draft: CropDraft | null) => void;
  onApplyCrop: () => void;
  onCancelCrop: () => void;
  filmstrip: FilmstripMode;
  showInfo: boolean;
  selection: ReturnType<typeof useSelection>;
  onEditChange: (image: ImageFile, edit: Edit) => void;
  onNavigate: (index: number) => void;
  onCloseLoupe: () => void;
  onRate: (path: string, rating: number) => void;
  onOpenLoupe: (index: number) => void;
};

function Content({
  openShoot,
  loaded,
  filteredImages,
  shoots,
  onOpenShoot,
  onNewProject,
  view,
  onView,
  sort,
  onSort,
  scoreReady,
  scoring,
  justRated,
  onImport,
  onShootSettings,
  filterActive,
  focusPath,
  inLoupe,
  loupeImages,
  loupeIndex,
  loupeEdit,
  cropDraft,
  onCropDraft,
  onApplyCrop,
  onCancelCrop,
  filmstrip,
  showInfo,
  selection,
  onEditChange,
  onNavigate,
  onCloseLoupe,
  onRate,
  onOpenLoupe,
}: ContentProps) {
  if (!openShoot) {
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

  if (!loaded) {
    return <p className="p-8 text-sm text-muted-foreground">loading…</p>;
  }

  if (inLoupe) {
    const image = loupeImages[loupeIndex];
    return (
      <Loupe
        images={loupeImages}
        index={loupeIndex}
        edit={loupeEdit}
        filmstrip={filmstrip}
        cropDraft={cropDraft}
        onCropDraft={onCropDraft}
        onApplyCrop={onApplyCrop}
        onCancelCrop={onCancelCrop}
        onEditChange={(edit) => onEditChange(image, edit)}
        onNavigate={onNavigate}
        onClose={onCloseLoupe}
        onRate={onRate}
      />
    );
  }

  const emptyMessage = filterActive
    ? "Nothing matches the rating filter."
    : "No photos in this project yet. Import them, or drop files into the folder — subfolders are fine.";
  const selectMode = !selection.isEmpty;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <BrowserToolbar
        purpose="Cull and rate. Click a photo for the loupe; Export takes the selection."
        view={view}
        onView={onView}
        sort={sort}
        onSort={onSort}
        scoreReady={scoreReady}
        scoring={scoring}
        justRated={justRated}
      />
      {filteredImages.length === 0 ? (
        <div className="flex flex-col items-start gap-3 p-8">
          <p
            data-testid="browser-empty"
            className="text-muted-foreground text-sm"
          >
            {emptyMessage}
          </p>
          {!filterActive && (
            <Button size="sm" data-testid="empty-import" onClick={onImport}>
              <Download />
              Import photos
            </Button>
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          {view === "grid" ? (
            <ImageGrid
              images={filteredImages}
              onOpen={onOpenLoupe}
              showInfo={showInfo}
              selected={selection.selected}
              selectMode={selectMode}
              onSelect={selection.click}
              focusPath={focusPath}
            />
          ) : (
            <ImageList
              images={filteredImages}
              selected={selection.selected}
              selectMode={selectMode}
              onSelect={selection.click}
              onOpen={onOpenLoupe}
              emptyMessage={emptyMessage}
              focusPath={focusPath}
            />
          )}
        </div>
      )}
    </div>
  );
}
