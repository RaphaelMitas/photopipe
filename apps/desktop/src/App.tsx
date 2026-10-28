import { Button } from "@photopipe/ui/components/button";
import {
  SidebarInset,
  SidebarProvider,
} from "@photopipe/ui/components/sidebar";
import { TooltipProvider } from "@photopipe/ui/components/tooltip";
import { useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import {
  AlertCircle,
  Check,
  RefreshCw,
  SlidersHorizontal,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AppSidebar } from "@/components/AppSidebar";
import { BrowserPane } from "@/components/BrowserPane";
import { Dashboard } from "@/components/Dashboard";
import { EditSidebar } from "@/components/EditPanel";
import {
  ExportDrawer,
  type ExportOptions,
  exportLabel,
} from "@/components/ExportDrawer";
import { HistoryControls } from "@/components/HistoryControls";
import { IndexingStatus } from "@/components/IndexingStatus";
import { Loupe } from "@/components/Loupe";
import { LoupeSidebar } from "@/components/LoupeSidebar";
import { NewProjectDialog } from "@/components/NewProjectDialog";
import { ratingCounts, useRatingFilter } from "@/components/RatingFilter";
import { RootPicker } from "@/components/RootPicker";
import { SelectionBar } from "@/components/SelectionBar";
import {
  autoScorePref,
  SettingsDialog,
  type SettingsSection,
} from "@/components/SettingsDialog";
import { ShootSettingsDialog } from "@/components/ShootSettingsDialog";
import { ShortcutSheet } from "@/components/ShortcutSheet";
import { ShortcutTooltip } from "@/components/ShortcutTooltip";
import { ShowSidebarTrigger } from "@/components/ShowSidebarTrigger";
import {
  type Edit,
  editKey,
  type Flag,
  type ImageFile,
  identityEdit,
  isIdentityEdit,
} from "@/lib/core";
import { type EditClipboard, pasteEdit } from "@/lib/editClipboard";
import { useFeatures } from "@/lib/features";
import { fileName } from "@/lib/fileName";
import {
  clearHistory,
  forgetHistoryPaths,
  type HistoryDirection,
  type HistoryEntry,
  historyLabel,
  jumpHistory,
  stepHistory,
} from "@/lib/history";
import { betterThan, scoreRanks } from "@/lib/instinct";
import type { Context } from "@/lib/keymap";
import { heldOrder } from "@/lib/loupeWalk";
import { pluralize } from "@/lib/plural";
import { flagPref } from "@/lib/pref";
import {
  cachedImage,
  jobStatus,
  useEnriched,
  useExportJobs,
  useImages,
  useLibrarySync,
  useReveal,
  useScoring,
  useShoots,
  useStacking,
  useTrash,
} from "@/lib/queries";
import {
  openRoot,
  type PhotoSource,
  pickPhotos,
  type RootError,
  rootsQuery,
  toRootError,
} from "@/lib/roots";
import { useSelection } from "@/lib/selection";
import {
  activeContext,
  ratingHandlers,
  shortcutLabel,
  useShortcuts,
} from "@/lib/shortcuts";
import { browserOrder, type SortKey, sortPref } from "@/lib/sort";
import {
  anchorFor,
  coverOf,
  groupStacks,
  inStack,
  ratedTo,
  type Stack,
  sharedFlag,
  stackedOrder,
  stackOf,
  stacksPref,
  sweepStack,
  toggled,
  toggledFlag,
  toggledFlags,
} from "@/lib/stacks";
import { useCropSession } from "@/lib/useCropSession";
import { useDebouncedEdit } from "@/lib/useDebouncedEdit";
import { useRecordedWrites } from "@/lib/useRecordedWrites";
import { useUpdater } from "@/lib/useUpdater";

const NO_HELD = { key: "", paths: [] };
const LEGACY_ROOT_KEY = "photopipe.root";
const LEGACY_RECENTS_KEY = "photopipe.recentRoots";

type RootState =
  | { kind: "picking"; error: RootError | null; busy: boolean }
  | { kind: "ready"; path: string; generation: number };

const EDIT_COMMIT_MS = 400;

const undoHint = () => {
  const key = shortcutLabel("history.undo");
  return key ? `${key} undoes` : undefined;
};

const editPanelPref = flagPref("photopipe.editPanel", "shown", "hidden", true);

export default function App() {
  const [rootState, setRootState] = useState<RootState>({
    kind: "picking",
    error: null,
    busy: false,
  });
  const [openShoot, setOpenShoot] = useState<string | null>(null);
  const [newProject, setNewProject] = useState(false);
  const [shootSettings, setShootSettings] = useState<string | null>(null);
  const [settings, setSettings] = useState<SettingsSection | null>(null);
  const [sheet, setSheet] = useState<Context | null>(null);
  const openSettings = useCallback(
    () => setSettings((section) => section ?? "general"),
    [],
  );
  const sort = sortPref.use();
  const autoScore = autoScorePref.use();
  // outlives the loupe, so closing it lands the browser on the same photo
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [loupeOpen, setLoupeOpen] = useState(false);
  // a frame, not the stack id: an earlier frame arriving renames the stack and must not throw you out
  const [insideAnchor, setInsideAnchor] = useState<string | null>(null);
  const filter = useRatingFilter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const editOpen = editPanelPref.use();
  const [clipboard, setClipboard] = useState<EditClipboard | null>(null);
  const queryClient = useQueryClient();

  const connectRoot = useCallback(
    async (path?: string) => {
      setRootState({ kind: "picking", error: null, busy: true });
      try {
        const opened = await openRoot(path);
        setRootState(
          opened
            ? {
                kind: "ready",
                path: opened.path,
                generation: opened.generation,
              }
            : { kind: "picking", error: null, busy: false },
        );
        return opened !== null;
      } catch (error) {
        setRootState({
          kind: "picking",
          error: toRootError(error),
          busy: false,
        });
        void queryClient.invalidateQueries(rootsQuery);
        return false;
      }
    },
    [queryClient],
  );

  useEffect(() => {
    queryClient
      .fetchQuery(rootsQuery)
      .then(async (roots) => {
        if (roots[0]?.status === "ok") {
          connectRoot(roots[0].path);
          return;
        }
        // A failed migration keeps the keys, so an unplugged drive gets another try.
        const legacy = localStorage.getItem(LEGACY_ROOT_KEY);
        if (roots.length === 0 && legacy && (await connectRoot(legacy))) {
          localStorage.removeItem(LEGACY_ROOT_KEY);
          localStorage.removeItem(LEGACY_RECENTS_KEY);
        }
      })
      .catch((error) => {
        setRootState({
          kind: "picking",
          error: toRootError(error),
          busy: false,
        });
      });
  }, [connectRoot, queryClient]);

  const ready = rootState.kind === "ready";
  const shoots = useShoots(ready);
  const images = useImages(openShoot);
  const { progress: scoring, justRated } = useScoring(
    openShoot,
    ready && autoScore,
  );
  const stacksWanted = stacksPref.use();
  const stacking = useStacking(openShoot, ready && stacksWanted);
  const stacksOn = stacksWanted && stacking.ready;
  const enriched = useEnriched(openShoot, ready);
  const writes = useRecordedWrites(openShoot);
  const reveal = useReveal();
  const revealPaths = useFeatures().reveal
    ? (paths: string[]) => reveal.mutate(paths)
    : undefined;
  const trash = useTrash(openShoot);
  const exports = useExportJobs();
  const scan = useLibrarySync(ready, ready ? rootState.generation : null);

  const allImages = images.data ?? [];
  // A finished pass is the signal, not a score on every photo: the core counts
  // a file it cannot read as answered, and one of those would otherwise keep
  // Instinct greyed out for the whole project forever.
  const scoreReady = scoring
    ? scoring.total > 0 && !scoring.running && scoring.done >= scoring.total
    : allImages.length > 0 && allImages.every((image) => image.score != null);
  // Sorting a half-rated project would put photos in an order the scores do not
  // support, so until the pass is done the browser falls back to name. Date
  // waits the same way for enrichment, which reads the capture times.
  const sortReady = {
    name: true,
    date: enriched,
    rating: true,
    score: scoreReady,
  } satisfies Record<SortKey, boolean>;
  const activeSort = sortReady[sort] ? sort : "name";
  const filteredImages = useMemo(
    () => browserOrder(allImages, filter.matches, activeSort),
    [allImages, filter.matches, activeSort],
  );
  const ranks = useMemo(() => scoreRanks(allImages), [allImages]);
  const counts = useMemo(() => ratingCounts(allImages), [allImages]);

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
    cancel: cancelEdit,
    hold: holdEdit,
  } = useDebouncedEdit(writes.writeEdit, EDIT_COMMIT_MS);
  // Before the core has read the file, an edit is relative to a blank
  // placeholder and would erase the real one.
  const readable = useCallback((image: ImageFile) => {
    if (image.enriched) return true;
    toast("Still reading this photo's existing edits", { id: "not-indexed" });
    return false;
  }, []);
  const editOf = useCallback(
    (image: ImageFile) =>
      editDraft?.path === image.path ? editDraft.edit : image.edit,
    [editDraft],
  );
  const changeEdit = (image: ImageFile, edit: Edit) => {
    if (!readable(image)) return;
    scrubEdit(image.path, edit);
  };

  const updater = useUpdater({
    blockedReason: exports.running
      ? "Finish the running job first; installing restarts Photopipe."
      : null,
    beforeInstall: flushEdit,
  });

  const { check: checkForUpdates } = updater;
  // check is stable, so this subscribes once and no menu click falls in a gap
  useEffect(() => {
    const subscriptions = [
      listen("menu:settings", openSettings),
      listen("menu:check-updates", () => void checkForUpdates()),
    ];
    for (const subscription of subscriptions) subscription.catch(() => {});
    return () => {
      for (const subscription of subscriptions) {
        void subscription.then((unlisten) => unlisten()).catch(() => {});
      }
    };
  }, [checkForUpdates, openSettings]);

  const currentShoot = shoots.data?.find((s) => s.name === openShoot);

  const runImport = async (from: PhotoSource) => {
    if (!openShoot) return;
    const paths = await pickPhotos("Import photos", from).catch(() => []);
    if (paths.length === 0) return;
    const job = await exports.start({
      method: "importFiles",
      label: `Import ${pluralize(paths.length, "file")}`,
      destination: currentShoot?.path ?? openShoot,
      request: { shoot: openShoot, paths },
    });
    if (job && job.total < paths.length) {
      toast.info(
        `${paths.length - job.total} of ${paths.length} skipped — already imported or not photos`,
      );
    }
  };

  const runExport = (options: ExportOptions, destination: string) => {
    if (!openShoot) return;
    void exports.start({
      method: "exportFiles",
      label: exportLabel(selectedImages.length, options.format),
      request: {
        shoot: openShoot,
        paths: selectedImages.map((image) => image.path),
        destination,
        zip: options.zip,
        flatten: options.flatten,
        format: options.format,
        quality: options.quality,
        longEdge: options.longEdge,
        decoderVersion: options.decoderVersion,
        names: options.names,
      },
    });
  };

  // Keyed on the sort you chose, not the one in force: a scoring pass finishing
  // must not re-order the loupe under you mid-visit.
  const held = useRef<{ key: string; paths: string[] }>({ key: "", paths: [] });
  const heldKey = `${openShoot}|${sort}|${filter.key}|${stacksOn}`;
  const openImage = currentPath
    ? allImages.find((image) => image.path === currentPath)
    : undefined;
  const reorder =
    held.current.key !== heldKey ||
    (openImage !== undefined && !held.current.paths.includes(openImage.path));

  const loupeImages = useMemo(() => {
    const live = (stacksOn ? stackedOrder : browserOrder)(
      allImages,
      filter.matches,
      activeSort,
      openImage,
    );
    if (!openImage || reorder) return live;
    const order = heldOrder(held.current.paths, live);
    // holding can slot a newcomer beside the wrong held photo; regrouping puts it back in its stack
    return stacksOn
      ? groupStacks(order).flatMap((stack) => stack.frames)
      : order;
  }, [stacksOn, allImages, openImage, reorder, filter.matches, activeSort]);

  held.current = {
    key: heldKey,
    paths: loupeImages.map((image) => image.path),
  };

  const loupeStacks = useMemo(
    () => (stacksOn ? groupStacks(loupeImages) : null),
    [stacksOn, loupeImages],
  );
  const currentStack =
    loupeStacks && openImage ? stackOf(loupeStacks, openImage.path) : undefined;
  const multiFrame =
    currentStack !== undefined && currentStack.frames.length > 1;
  const insideStack = multiFrame && inStack(currentStack, insideAnchor);
  const loupeIndex = openImage ? loupeImages.indexOf(openImage) : -1;
  const loupeImage = loupeIndex >= 0 ? loupeImages[loupeIndex] : null;
  const loupeEdit = loupeImage === null ? identityEdit : editOf(loupeImage);
  // The browser keeps the current photo after the loupe closes, so anything
  // acting on "the photo you are looking at" has to ask whether it is open.
  const loupePhoto = loupeOpen ? loupeImage : null;
  const [split, setSplit] = useState(false);
  if (split && !loupePhoto) setSplit(false);
  const toggleSplit = useCallback(() => setSplit((on) => !on), []);

  // stacks arriving or an import can regroup you onto a non-cover frame, which means inside
  const membership = currentStack?.frames.map((frame) => frame.path).join("\n");
  const decided = useRef({ membership, currentPath });
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a regroup under the same photo re-decides; a move decided its own anchor
  useEffect(() => {
    const regrouped =
      decided.current.membership !== membership &&
      decided.current.currentPath === currentPath;
    decided.current = { membership, currentPath };
    if (regrouped && !insideStack) {
      setInsideAnchor(anchorFor(currentStack, currentPath));
    }
  }, [membership, currentPath]);
  // Read at keypress, not render: a rating typed a moment ago may not have re-rendered yet.
  const readLive = (photos: ImageFile[]) => {
    const live = photos.map(
      (photo) => cachedImage(queryClient, openShoot, photo.path) ?? photo,
    );
    if (live.some((photo) => !photo.enriched)) {
      toast("Still reading these photos' ratings", { id: "not-indexed" });
      return null;
    }
    return live;
  };
  const ratePhotos = (photos: ImageFile[], rating: number, stack?: Stack) => {
    const live = readLive(photos);
    if (!live) return null;
    writes.rateMany(ratedTo(live, rating), live, stack);
    return rating;
  };
  const flagPhotos = (photos: ImageFile[], flag: Flag, stack?: Stack) => {
    const live = readLive(photos);
    if (!live) return null;
    writes.flagMany(toggledFlags(live, flag), live, stack);
    return toggledFlag(live, flag);
  };
  const sweep = (stack: Stack) => {
    const frames = readLive(stack.frames);
    if (!frames) return false;
    const swept = sweepStack({ ...stack, frames });
    if (swept.size === 0) return false;
    void writes.flagMany(swept, frames).then(
      () =>
        toast(`Rejected ${pluralize(swept.size, "undecided frame")}`, {
          id: "sweep",
          description: undoHint(),
        }),
      () => {},
    );
    return true;
  };
  const outsideStack = currentStack && multiFrame && !insideStack;
  const rateShown = (path: string, rating: number) => {
    if (outsideStack)
      return ratePhotos(currentStack.frames, rating, currentStack);
    writes.rate(path, rating);
    return rating;
  };
  const flagShown = (path: string, flag: Flag) => {
    if (outsideStack)
      return flagPhotos(currentStack.frames, flag, currentStack);
    const photo = cachedImage(queryClient, openShoot, path);
    if (!photo) return null;
    const to = toggled(photo.flag, flag);
    writes.flag(path, to);
    return to;
  };
  const visit = (path: string | null, stacks: Stack[] | null) => {
    setCurrentPath(path);
    const stack = path && stacks ? stackOf(stacks, path) : undefined;
    // inside, the anchor follows you, so a regroup can only err toward rating one frame
    if (insideStack && stack === currentStack) {
      setInsideAnchor(path);
      return;
    }
    setInsideAnchor(anchorFor(stack, path));
  };
  const crop = useCropSession(loupePhoto, loupeEdit, changeEdit);
  const cropping = crop.draft !== null;

  // a filtered-out photo is not in the browser, so land on the nearest one that is
  const focusPath = useMemo(() => {
    if (loupeIndex === -1) return null;
    const inBrowser = new Set(filteredImages);
    for (let step = 0; step < loupeImages.length; step++) {
      for (const at of [loupeIndex + step, loupeIndex - step]) {
        const image = loupeImages[at];
        if (image && inBrowser.has(image)) return image.path;
      }
    }
    return null;
  }, [loupeImages, loupeIndex, filteredImages]);

  const copySource =
    loupePhoto ?? (selectedImages.length === 1 ? selectedImages[0] : null);
  const pasteTargets = loupePhoto ? [loupePhoto] : selectedImages;

  const copySettings = useCallback(
    (image: ImageFile) => {
      if (!readable(image)) return;
      setClipboard({
        path: image.path,
        edit: editOf(image),
        raw: image.isRaw,
      });
      toast(`Copied settings from ${fileName(image.path)}`, {
        id: "clipboard",
      });
    },
    [editOf, readable],
  );

  const pasteSettings = useCallback(
    async (targets: ImageFile[]) => {
      if (!clipboard) {
        toast("Copy settings off a photo first", { id: "clipboard" });
        return;
      }
      if (targets.length === 0) {
        toast("Select the photos to paste onto", { id: "clipboard" });
        return;
      }
      const ready = targets.filter((image) => image.enriched);
      const pasted = new Map<string, Edit>();
      let keptWhiteBalance = 0;
      for (const image of ready) {
        const current = editOf(image);
        const raw = image.isRaw;
        const next = pasteEdit(current, clipboard, raw);
        if (editKey(next) === editKey(current)) continue;
        if (
          next.temperature !== clipboard.edit.temperature ||
          next.tint !== clipboard.edit.tint
        ) {
          keptWhiteBalance += 1;
        }
        pasted.set(image.path, next);
      }
      const notReady = targets.length - ready.length;
      const unchanged = ready.length - pasted.size;
      if (pasted.size === 0) {
        toast(
          ready.length === 0
            ? "Still reading those photos' existing edits"
            : "Those photos already have these settings",
          { id: "clipboard" },
        );
        return;
      }
      if (editDraft && pasted.has(editDraft.path)) {
        cancelEdit();
      }
      const result = await writes.paste(pasted).catch(() => null);
      if (!result) {
        toast.error("Pasting settings failed", { id: "clipboard" });
        return;
      }
      if (result.written === 0) return;
      const notes = [
        notReady > 0 ? `${notReady} not read yet` : null,
        unchanged > 0 ? `${unchanged} already matched` : null,
        result.overtaken > 0 ? `${result.overtaken} edited since` : null,
        keptWhiteBalance > 0
          ? `${keptWhiteBalance} kept their own white balance`
          : null,
      ].filter(Boolean);
      toast.success(
        `Pasted settings onto ${pluralize(result.written, "photo")}`,
        { description: notes.length > 0 ? notes.join(" · ") : undefined },
      );
    },
    [clipboard, editDraft, editOf, cancelEdit, writes.paste],
  );

  const [historyOpen, setHistoryOpen] = useState(false);
  const [revealed, setRevealed] = useState(0);
  // an undo resolves after the keypress, so it reads where you are now, not then
  const currentPathNow = useRef(currentPath);
  currentPathNow.current = currentPath;
  const stacksNow = useRef(loupeStacks);
  // the browser has no stacks, so undo there lands on the photo it changed
  stacksNow.current = loupeOpen ? loupeStacks : null;
  const insideNow = useRef(insideStack);
  insideNow.current = insideStack;
  // Before the write, so you are on the photo when the step lands.
  const showPhoto = useCallback(
    (entry: HistoryEntry) => {
      const present = (path: string) =>
        cachedImage(queryClient, openShoot, path) !== undefined;
      const current = currentPathNow.current;
      const stacks = stacksNow.current;
      // inside a stack, a step on a sibling frame still moves you to it
      const here =
        current && stacks && (entry.wholeStack || !insideNow.current)
          ? stackOf(stacks, current)
          : undefined;
      const touchesHere = entry.paths.some((path) =>
        here ? inStack(here, path) : path === current,
      );
      const next = touchesHere ? undefined : entry.paths.find(present);
      if (next) {
        setCurrentPath(next);
        // you land on the frame the step changed, inside its stack unless the step was on the whole stack
        setInsideAnchor(entry.wholeStack ? null : next);
      }
      setRevealed((count) => count + 1);
    },
    [queryClient, openShoot],
  );
  const travel = useCallback(
    (direction: HistoryDirection) => {
      flushEdit();
      void stepHistory(direction, showPhoto).then((entry) => {
        if (!entry) return;
        const verb = direction === "undo" ? "Undid" : "Redid";
        toast(`${verb} ${historyLabel(entry)}`, { id: "history" });
      });
    },
    [flushEdit, showPhoto],
  );
  const jump = useCallback(
    (entry: HistoryEntry | null) => {
      flushEdit();
      if (entry) showPhoto(entry);
      void jumpHistory(entry).then((steps) => {
        if (steps === 0) return;
        toast(`Moved ${pluralize(steps, "step")} in history`, {
          id: "history",
        });
      });
    },
    [flushEdit, showPhoto],
  );

  useEffect(() => {
    if (currentPath && loupeIndex === -1) {
      setCurrentPath(null);
      setLoupeOpen(false);
    }
  }, [currentPath, loupeIndex]);

  const openExport = useCallback(() => {
    if (loupePhoto) {
      setLoupeOpen(false);
      selection.select([loupePhoto.path]);
      setDrawerOpen(true);
      return;
    }
    setDrawerOpen((open) => !open);
  }, [loupePhoto, selection]);

  useShortcuts({
    "app.settings": openSettings,
    "app.shortcuts": () => setSheet(activeContext()),
    "history.undo": () => (openShoot ? travel("undo") : false),
    "history.redo": () => (openShoot ? travel("redo") : false),
    "history.show": () => (openShoot ? setHistoryOpen((open) => !open) : false),
    "settings.copy": () => (copySource ? copySettings(copySource) : false),
    "settings.paste": () => (openShoot ? pasteSettings(pasteTargets) : false),
    "export.open": () => (openShoot ? openExport() : false),
  });
  const withSelection = (act: () => unknown) =>
    selection.isEmpty ? false : act();
  useShortcuts(
    {
      "select.all": selection.selectAll,
      "select.clear": () => withSelection(selection.clear),
      ...ratingHandlers((rating) =>
        withSelection(() => ratePhotos(selectedImages, rating)),
      ),
      "flag.pick": () => withSelection(() => flagPhotos(selectedImages, 1)),
      "flag.reject": () => withSelection(() => flagPhotos(selectedImages, -1)),
      "flag.clear": () => withSelection(() => flagPhotos(selectedImages, 0)),
    },
    "browser",
  );
  useShortcuts({
    "editPanel.toggle": editPanelPref.toggle,
    "stacks.toggle": stacksPref.toggle,
    "split.toggle": toggleSplit,
  });

  const trashPhotos = (paths: string[]) =>
    // even a failed trash may have moved some of them
    void trash
      .mutateAsync(paths)
      .catch(() => {})
      .finally(() => forgetHistoryPaths(paths));
  const rejects = useMemo(
    () => allImages.filter((image) => image.flag === -1),
    [allImages],
  );

  const enterShoot = (shoot: string | null) => {
    flushEdit();
    clearHistory();
    setOpenShoot(shoot);
    if (shoot) scan.refresh();
    setCurrentPath(null);
    setLoupeOpen(false);
    filter.reset();
    selection.clear();
  };

  // Settings is reachable from the menu bar at any time, including before a
  // photos folder is picked, so it lives outside the browser chrome.
  const settingsDialog = (
    <>
      <SettingsDialog
        section={settings}
        onSectionChange={setSettings}
        onCheckUpdates={updater.enabled ? checkForUpdates : undefined}
      />
      <ShortcutSheet
        context={sheet}
        onClose={() => setSheet(null)}
        onEdit={() => {
          setSheet(null);
          setSettings("keyboard");
        }}
      />
    </>
  );

  if (!ready) {
    return (
      <>
        <RootPicker
          error={rootState.error}
          busy={rootState.busy}
          onPick={connectRoot}
        />
        {settingsDialog}
      </>
    );
  }

  const inLoupe = openShoot !== null && loupePhoto !== null;

  const latestJob = exports.jobs[0];

  const content = !openShoot ? (
    shoots.data ? (
      <div className="h-full overflow-auto">
        <Dashboard
          shoots={shoots.data}
          onOpen={enterShoot}
          onNewProject={() => setNewProject(true)}
          onSettings={setShootSettings}
        />
      </div>
    ) : (
      <p className="p-8 text-sm text-muted-foreground">scanning library…</p>
    )
  ) : images.data === undefined ? (
    <p className="p-8 text-sm text-muted-foreground">loading…</p>
  ) : loupePhoto ? (
    <Loupe
      images={loupeImages}
      index={loupeIndex}
      edit={loupeEdit}
      crop={crop}
      split={split}
      stacks={
        loupeStacks && currentStack
          ? {
              list: loupeStacks,
              current: currentStack,
              inside: insideStack,
              onEnter: () => setInsideAnchor(loupePhoto.path),
              onLeave: () => {
                setCurrentPath(coverOf(currentStack).path);
                setInsideAnchor(null);
              },
              onSweep: () => sweep(currentStack),
            }
          : null
      }
      onEditChange={(edit) => changeEdit(loupePhoto, edit)}
      onNavigate={(path) => visit(path, loupeStacks)}
      onClose={() => setLoupeOpen(false)}
      onRate={rateShown}
      onFlag={flagShown}
    />
  ) : (
    <BrowserPane
      images={filteredImages}
      sort={activeSort}
      sortReady={sortReady}
      scoring={scoring}
      justRated={justRated}
      filterActive={filter.active}
      selected={selection.selected}
      onSelect={selection.click}
      focusPath={focusPath}
      revealed={revealed}
      rejects={rejects}
      onTrashRejects={() => trashPhotos(rejects.map((image) => image.path))}
      onOpen={(index) => {
        // A new visit walks the browser's order as it stands now.
        held.current = NO_HELD;
        // closing, a grid undo or a shoot switch can leave an anchor behind, so opening decides it fresh
        const path = filteredImages[index]?.path ?? null;
        setCurrentPath(path);
        setInsideAnchor(
          anchorFor(
            path && stacksOn
              ? stackOf(groupStacks(allImages), path)
              : undefined,
            path,
          ),
        );
        setLoupeOpen(true);
      }}
      onImport={runImport}
    />
  );

  return (
    <TooltipProvider delayDuration={400}>
      <ShootSettingsDialog
        open={shootSettings !== null}
        onOpenChange={(next) => !next && setShootSettings(null)}
        shoot={shoots.data?.find((s) => s.name === shootSettings)}
        onSaved={(saved) => {
          setShootSettings(null);
          if (openShoot !== shootSettings) return;
          // a rename moves the folder out from under every recorded path
          if (saved !== openShoot) clearHistory();
          setOpenShoot(saved);
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
            position={
              loupeStacks && currentStack
                ? `stack ${loupeStacks.indexOf(currentStack) + 1}/${loupeStacks.length}`
                : `${loupeIndex + 1}/${loupeImages.length}`
            }
            stacks={{
              on: stacksWanted,
              ready: stacking.ready,
              progress: stacking.progress,
              onToggle: stacksPref.toggle,
              current:
                currentStack && multiFrame
                  ? { stack: currentStack, inside: insideStack }
                  : null,
            }}
            betterThan={betterThan(
              ranks.get(loupeImage.path) ?? null,
              ranks.size,
            )}
            filter={filter}
            ratingCounts={counts}
            flag={
              outsideStack ? sharedFlag(currentStack.frames) : loupeImage.flag
            }
            onRate={rateShown}
            onFlag={flagShown}
            onBackToGrid={() =>
              cropping ? crop.cancel() : setLoupeOpen(false)
            }
          />
        ) : (
          <AppSidebar
            currentShoot={currentShoot}
            onBack={() => enterShoot(null)}
            onImport={runImport}
            onRevealShoot={revealPaths && ((path) => revealPaths([path]))}
            onShootSettings={() => setShootSettings(openShoot)}
            filter={filter}
            ratingCounts={counts}
            filterEnabled={openShoot !== null}
            rootPath={rootState.path}
            onChangeRoot={() => {
              clearHistory();
              setRootState({ kind: "picking", error: null, busy: false });
            }}
            onSettings={openSettings}
          />
        )}
        <SidebarInset className="flex h-screen min-w-0 flex-col bg-background text-foreground">
          <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
            <ShowSidebarTrigger />
            {currentShoot ? (
              <>
                <span className="truncate font-medium text-sm">
                  {currentShoot.name}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {pluralize(currentShoot.imageCount, "photo")}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground text-sm">Library</span>
            )}
            <span className="flex-1" />
            <IndexingStatus progress={scan.progress} />
            <ShortcutTooltip label="Look for new photos">
              <Button
                size="icon-sm"
                variant="ghost"
                data-testid="refresh"
                aria-label="Look for new photos"
                disabled={scan.refreshing}
                onClick={scan.refresh}
              >
                <RefreshCw className={scan.refreshing ? "animate-spin" : ""} />
              </Button>
            </ShortcutTooltip>
            {exports.jobs.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                data-testid="activity-pill"
                onClick={() => setDrawerOpen(true)}
                className="h-7 text-xs text-muted-foreground"
              >
                {exports.running ? (
                  <>
                    <span className="size-2 animate-pulse rounded-full bg-primary" />
                    Working…
                  </>
                ) : latestJob && jobStatus(latestJob) === "failed" ? (
                  <>
                    <AlertCircle className="text-destructive" />
                    Activity
                  </>
                ) : (
                  <>
                    <Check className="text-success" />
                    Activity
                  </>
                )}
              </Button>
            )}
            {openShoot && (
              <HistoryControls
                shoot={openShoot}
                open={historyOpen}
                onOpenChange={setHistoryOpen}
                disabled={cropping}
                onUndo={() => travel("undo")}
                onRedo={() => travel("redo")}
                onJump={jump}
              />
            )}
            {inLoupe && (
              <ShortcutTooltip
                label="Toggle edit panel"
                action="editPanel.toggle"
              >
                <Button
                  size="sm"
                  variant={editOpen ? "secondary" : "ghost"}
                  data-testid="toggle-edit"
                  onClick={editPanelPref.toggle}
                  disabled={cropping}
                  className="h-7 text-xs"
                >
                  <SlidersHorizontal />
                  Edit
                </Button>
              </ShortcutTooltip>
            )}
            {openShoot && (
              <ShortcutTooltip label="Export" action="export.open">
                <Button
                  size="sm"
                  data-testid="open-export"
                  onClick={() => openExport()}
                  className="h-7 text-xs"
                >
                  <Upload />
                  Export
                  {selection.selected.size > 0 && ` ${selection.selected.size}`}
                  …
                </Button>
              </ShortcutTooltip>
            )}
          </header>
          <SelectionBar
            count={selection.selected.size}
            busy={exports.running}
            canPaste={clipboard !== null}
            onCopySettings={() => copySource && copySettings(copySource)}
            onPasteSettings={() => pasteSettings(pasteTargets)}
            onExport={() => setDrawerOpen(true)}
            onReveal={
              revealPaths &&
              (() => revealPaths(selectedImages.map((image) => image.path)))
            }
            onDelete={() =>
              trashPhotos(selectedImages.map((image) => image.path))
            }
            onClear={selection.clear}
          />
          <div className="flex min-h-0 flex-1">
            <div className="min-w-0 flex-1">{content}</div>
            {inLoupe && loupeImage && editOpen && (
              <EditSidebar
                image={loupeImage}
                edit={loupeEdit}
                onChange={(edit) => changeEdit(loupeImage, edit)}
                onHold={holdEdit}
                crop={crop}
                split={split}
                onToggleSplit={toggleSplit}
                canPaste={clipboard !== null}
                onCopySettings={() => copySettings(loupeImage)}
                onPasteSettings={() => pasteSettings([loupeImage])}
                onClose={editPanelPref.toggle}
              />
            )}
            {drawerOpen && openShoot && !inLoupe && (
              <ExportDrawer
                shoot={openShoot}
                images={selectedImages}
                sort={activeSort}
                selectedCount={selection.selected.size}
                editedCount={editedCount}
                filteredCount={filteredImages.length}
                totalCount={allImages.length}
                filterActive={filter.active}
                jobs={exports.jobs}
                busy={exports.running}
                onSelectFiltered={() => selection.select(orderedPaths)}
                onSelectAll={() => {
                  filter.reset();
                  selection.select(allImages.map((image) => image.path));
                }}
                onClearSelection={selection.clear}
                onExport={runExport}
                onCancel={exports.cancel}
                onReveal={revealPaths && ((path) => revealPaths([path]))}
                onClose={() => setDrawerOpen(false)}
              />
            )}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
