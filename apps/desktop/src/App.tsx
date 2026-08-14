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
import { AboutDialog } from "@/components/AboutDialog";
import { AppSidebar } from "@/components/AppSidebar";
import { BrowserToolbar, type ViewMode } from "@/components/BrowserToolbar";
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
import {
  useExportFiles,
  useGenerationPoll,
  useImages,
  useImportFiles,
  useReveal,
  useSetEdit,
  useSetRating,
  useShoots,
  useTrash,
} from "@/lib/queries";
import { useSelection } from "@/lib/selection";
import { useDebouncedEdit } from "@/lib/useDebouncedEdit";
import { useUpdater } from "@/lib/useUpdater";

const ROOT_KEY = "photopipe.root";
const VIEW_KEY = "photopipe.view";
const EDIT_PANEL_KEY = "photopipe.editPanel";

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
  const [about, setAbout] = useState(false);
  const updater = useUpdater();
  const [view, setView] = useState<ViewMode>(() =>
    localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid",
  );
  const changeView = (next: ViewMode) => {
    setView(next);
    localStorage.setItem(VIEW_KEY, next);
  };
  const [loupePath, setLoupePath] = useState<string | null>(null);
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
  const setRating = useSetRating(openShoot);
  const setEdit = useSetEdit(openShoot);
  const reveal = useReveal();
  const trash = useTrash(openShoot);
  const exportFiles = useExportFiles();
  const importFiles = useImportFiles(openShoot);
  useGenerationPoll(ready, ready ? rootState.generation : null);

  const allImages = images.data ?? [];
  const filteredImages = useMemo(
    () =>
      allImages.filter((image) =>
        matchesRatingFilter(image.rating, ratingOp, ratingStars),
      ),
    [allImages, ratingOp, ratingStars],
  );
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
  const changeEdit = (image: ImageFile, edit: Edit) =>
    scrubEdit(image.path, edit);

  const installBlocked = jobs.some((job) => job.status === "running")
    ? "Finish the running export first; installing restarts Photopipe."
    : null;
  const startInstall = useCallback(() => {
    if (installBlocked) return;
    flushEdit();
    void updater.install();
  }, [installBlocked, flushEdit, updater]);

  const { state: updateState } = updater;
  const offered = useRef(false);
  useEffect(() => {
    if (updateState.kind !== "available" || offered.current) return;
    offered.current = true;
    toast(`Photopipe ${updateState.version} is available`, {
      duration: Number.POSITIVE_INFINITY,
      action: {
        label: "Install",
        onClick: () => {
          setAbout(true);
          startInstall();
        },
      },
    });
  }, [updateState, startInstall]);

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
    if (!loupePath) return filteredImages;
    if (filteredImages.some((image) => image.path === loupePath)) {
      return filteredImages;
    }
    const position = new Map(allImages.map((image, i) => [image.path, i]));
    const pinnedAt = position.get(loupePath);
    if (pinnedAt === undefined) return filteredImages;
    const result = [...filteredImages];
    const insertAt = result.findIndex(
      (image) => (position.get(image.path) ?? -1) > pinnedAt,
    );
    if (insertAt === -1) result.push(allImages[pinnedAt]);
    else result.splice(insertAt, 0, allImages[pinnedAt]);
    return result;
  }, [filteredImages, allImages, loupePath]);

  const loupeIndex = loupePath
    ? loupeImages.findIndex((image) => image.path === loupePath)
    : -1;

  useEffect(() => {
    if (loupePath && loupeIndex === -1) setLoupePath(null);
  }, [loupePath, loupeIndex]);

  const openExport = useCallback(() => {
    const loupeImage = loupeIndex >= 0 ? loupeImages[loupeIndex] : null;
    if (loupeImage) {
      setLoupePath(null);
      if (!filteredImages.some((image) => image.path === loupeImage.path)) {
        setRatingStars(0);
        setRatingOp((op) => (op === "unrated" ? "gte" : op));
      }
      selection.select([loupeImage.path]);
      setDrawerOpen(true);
      return;
    }
    setDrawerOpen((open) => !open);
  }, [loupeIndex, loupeImages, filteredImages, selection]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey) {
        if (event.key === "a" && loupeIndex === -1) {
          event.preventDefault();
          selection.selectAll();
        }
        if (event.key === "e" && openShoot) {
          event.preventDefault();
          openExport();
        }
        return;
      }
      if (event.key === "Escape" && loupeIndex === -1 && !selection.isEmpty) {
        selection.clear();
      }
      if (event.key === "e" && !event.altKey && loupeIndex >= 0) {
        toggleEditPanel();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selection, loupeIndex, openShoot, openExport, toggleEditPanel]);

  const changeRatingStars = (stars: number) => {
    setRatingStars(stars);
    if (stars > 0 && ratingOp === "unrated") setRatingOp("gte");
  };

  const enterShoot = (shoot: string | null) => {
    flushEdit();
    setOpenShoot(shoot);
    setLoupePath(null);
    setRatingStars(0);
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
  const inLoupe = openShoot !== null && loupeImage !== null;
  const loupeEdit =
    loupeImage === null
      ? identityEdit
      : editDraft?.path === loupeImage.path
        ? editDraft.edit
        : loupeImage.edit;

  const currentShoot = shoots.data?.find((s) => s.name === openShoot);
  const runningJobs = jobs.filter((job) => job.status === "running").length;
  const latestJob = jobs[0];

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
      <AboutDialog
        open={about}
        onOpenChange={setAbout}
        updater={updater}
        onInstall={startInstall}
        blocked={installBlocked}
      />
      <SidebarProvider>
        {inLoupe && loupeImage ? (
          <LoupeSidebar
            image={loupeImage}
            position={loupeIndex + 1}
            count={loupeImages.length}
            filmstrip={filmstrip}
            onFilmstrip={changeFilmstrip}
            ratingCounts={counts}
            ratingOp={ratingOp}
            onRatingOp={setRatingOp}
            ratingStars={ratingStars}
            onRatingStars={changeRatingStars}
            onRate={(path, rating) => setRating.mutate({ path, rating })}
            onBackToGrid={() => setLoupePath(null)}
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
            onAbout={() => setAbout(true)}
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
                title="Toggle edit panel (e)"
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
                onImport={runImport}
                onShootSettings={setShootSettings}
                filterActive={filterActive}
                inLoupe={inLoupe}
                loupeImages={loupeImages}
                loupeIndex={loupeIndex}
                loupeEdit={loupeEdit}
                filmstrip={filmstrip}
                showInfo={showInfo}
                selection={selection}
                onEditChange={changeEdit}
                onNavigate={(next) =>
                  setLoupePath(loupeImages[next]?.path ?? null)
                }
                onCloseLoupe={() => setLoupePath(null)}
                onRate={(path, rating) => setRating.mutate({ path, rating })}
                onOpenLoupe={(index) =>
                  setLoupePath(filteredImages[index]?.path ?? null)
                }
              />
            </div>
            {inLoupe && loupeImage && editOpen && (
              <EditSidebar
                image={loupeImage}
                edit={loupeEdit}
                onChange={(edit) => changeEdit(loupeImage, edit)}
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
  onImport: () => void;
  onShootSettings: (shoot: string) => void;
  filterActive: boolean;
  inLoupe: boolean;
  loupeImages: ImageFile[];
  loupeIndex: number;
  loupeEdit: Edit;
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
  onImport,
  onShootSettings,
  filterActive,
  inLoupe,
  loupeImages,
  loupeIndex,
  loupeEdit,
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
  if (filteredImages.length === 0) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <BrowserToolbar
          purpose="Cull and rate. Click a photo for the loupe; Export takes the selection."
          view={view}
          onView={onView}
        />
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
      </div>
    );
  }

  const selectMode = !selection.isEmpty;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <BrowserToolbar
        purpose="Cull and rate. Click a photo for the loupe; Export takes the selection."
        view={view}
        onView={onView}
      />
      <div className="min-h-0 flex-1">
        {view === "grid" ? (
          <ImageGrid
            images={filteredImages}
            onOpen={onOpenLoupe}
            showInfo={showInfo}
            selected={selection.selected}
            selectMode={selectMode}
            onSelect={selection.click}
          />
        ) : (
          <ImageList
            images={filteredImages}
            selected={selection.selected}
            selectMode={selectMode}
            onSelect={selection.click}
            onOpen={onOpenLoupe}
            emptyMessage={emptyMessage}
          />
        )}
      </div>
    </div>
  );
}
