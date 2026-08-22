import {
  keepPreviousData,
  type QueryClient,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  type CreateProjectResult,
  coreRequest,
  type Edit,
  type ExportFormat,
  editKey,
  type ImageFile,
  isRawFile,
  normalizeImage,
  type RawDefaultsResult,
  type SetEditResult,
  type SetRatingResult,
  type Shoot,
  type StatusResult,
} from "./core";
import { useRawDecoderVersion } from "./rawDecoder";
import type { ViewportRequest } from "./zoom";

export function useShoots(enabled: boolean) {
  return useQuery({
    queryKey: ["shoots"],
    queryFn: async () =>
      (await coreRequest<{ shoots: Shoot[] }>("listShoots")).shoots,
    enabled,
  });
}

export function useImages(shoot: string | null) {
  return useQuery({
    queryKey: ["images", shoot],
    queryFn: async () =>
      (
        await coreRequest<{ images: ImageFile[] }>("listImages", { shoot })
      ).images.map(normalizeImage),
    enabled: shoot !== null,
  });
}

export type ScoreProgress = {
  done: number;
  total: number;
  running: boolean;
};

const RATED_OFFER_MS = 8000;

/// Scores reach the grid through `listImages`, so images refetch when the pass
/// ends, not every tick. `justRated` is the window where the browser can hand
/// the sort over. Every fetch asks the core to score, not just the first: an
/// empty pass is free, and it is what picks up newly imported photos.
export function useScoring(shoot: string | null, enabled: boolean) {
  const client = useQueryClient();
  const wasRunning = useRef(false);
  const [justRated, setJustRated] = useState(false);

  const query = useQuery({
    queryKey: ["scoring", shoot],
    queryFn: () => coreRequest<ScoreProgress>("scoreShoot", { shoot }),
    enabled: enabled && shoot !== null,
    refetchInterval: (query) => (query.state.data?.running ? 1000 : false),
  });

  const running = query.data?.running ?? false;
  const lastShoot = useRef(shoot);
  useEffect(() => {
    const finished = wasRunning.current && !running;
    wasRunning.current = running;
    if (lastShoot.current !== shoot) {
      lastShoot.current = shoot;
      setJustRated(false);
      return;
    }
    if (!finished) return;
    void client.invalidateQueries({ queryKey: ["images", shoot] });
    setJustRated(true);
    const timer = setTimeout(() => setJustRated(false), RATED_OFFER_MS);
    return () => clearTimeout(timer);
  }, [running, shoot, client]);

  // a stale `running` would freeze the toolbar's progress line where it stopped
  return { progress: enabled ? (query.data ?? null) : null, justRated };
}

export function useThumbnail(
  file: { path: string; mtime: number } | undefined,
) {
  return useQuery({
    queryKey: ["thumb", file?.path, file?.mtime],
    queryFn: async () =>
      (
        await coreRequest<{ cachePath: string }>("thumbnail", {
          path: file?.path,
          maxPixel: 512,
        })
      ).cachePath,
    enabled: file !== undefined,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

type RenderFile = Pick<ImageFile, "path" | "mtime" | "ext"> | undefined;

const PREVIEW_MAX_PIXEL = 2560;

function renderDecoderVersion(file: RenderFile, version: number) {
  return file && isRawFile(file) ? version : undefined;
}

function renderQueryOptions(
  file: RenderFile,
  edit: Edit,
  maxPixel: number,
  viewport?: ViewportRequest["viewport"],
  decoderVersion?: number,
) {
  return {
    queryKey: [
      "render",
      file?.path,
      file?.mtime,
      editKey(edit),
      maxPixel,
      viewport
        ? `${viewport.left},${viewport.top},${viewport.right},${viewport.bottom}`
        : "",
      decoderVersion ?? "",
    ] as const,
    queryFn: async () =>
      (
        await coreRequest<{ cachePath: string }>("render", {
          path: file?.path,
          edit,
          maxPixel,
          ...(viewport ? { viewport } : {}),
          ...(decoderVersion ? { decoderVersion } : {}),
        })
      ).cachePath,
    staleTime: Number.POSITIVE_INFINITY,
  };
}

export function useRender(file: RenderFile, edit: Edit) {
  const decoder = useRawDecoderVersion();
  return useQuery({
    ...renderQueryOptions(
      file,
      edit,
      PREVIEW_MAX_PIXEL,
      undefined,
      renderDecoderVersion(file, decoder),
    ),
    enabled: file !== undefined,
    placeholderData: (previous: string | undefined, previousQuery) =>
      previousQuery?.queryKey[1] === file?.path ? previous : undefined,
  });
}

/// The zoomed loupe renders only the slice on screen, at 1:1. Asking for the
/// whole frame at native size costs several times as much and then gets
/// downscaled into the stage anyway.
export function useViewportRender(
  file: RenderFile,
  edit: Edit,
  request: ViewportRequest | null,
) {
  const decoder = useRawDecoderVersion();
  return useQuery({
    ...renderQueryOptions(
      file,
      edit,
      request?.maxPixel ?? 0,
      request?.viewport,
      renderDecoderVersion(file, decoder),
    ),
    enabled: file !== undefined && request !== null,
  });
}

export function usePrefetchRender(file: RenderFile, edit: Edit | undefined) {
  const queryClient = useQueryClient();
  const decoder = useRawDecoderVersion();
  useEffect(() => {
    if (!file || !edit) return;
    queryClient.prefetchQuery(
      renderQueryOptions(
        file,
        edit,
        PREVIEW_MAX_PIXEL,
        undefined,
        renderDecoderVersion(file, decoder),
      ),
    );
  }, [queryClient, file, edit, decoder]);
}

export function useRawDefaults(
  file: { path: string; mtime: number; ext: string } | undefined,
) {
  const decoderVersion = useRawDecoderVersion();
  return useQuery({
    queryKey: ["rawDefaults", file?.path, file?.mtime, decoderVersion],
    queryFn: async () =>
      coreRequest<RawDefaultsResult>("rawDefaults", {
        path: file?.path,
        decoderVersion,
      }),
    enabled: file !== undefined && isRawFile(file),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export type DecoderSupport = { raw9: number; rawTotal: number };

// support is per camera model and OS, so it cannot change during the session
export function useDecoderSupport(paths: string[], enabled: boolean) {
  // Sorting makes the key the selection's contents rather than the grid's
  // order, so re-sorting does not throw away an answer that cannot differ.
  const sorted = useMemo(() => [...paths].sort(), [paths]);
  return useQuery({
    queryKey: ["decoderSupport", sorted],
    queryFn: () =>
      coreRequest<DecoderSupport>("decoderSupport", { paths: sorted }),
    enabled: enabled && sorted.length > 0,
    staleTime: Number.POSITIVE_INFINITY,
    // an unanswered probe reads as "RAW 9 is fine", so hold the last verdict
    placeholderData: keepPreviousData,
  });
}

export const SET_RATING_KEY = ["setRating"];
export const SET_EDIT_KEY = ["setEdit"];

export function xmpWritesInFlight(
  queryClient: ReturnType<typeof useQueryClient>,
): number {
  return (
    queryClient.isMutating({ mutationKey: SET_RATING_KEY }) +
    queryClient.isMutating({ mutationKey: SET_EDIT_KEY })
  );
}

export function useSetRating(shoot: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: SET_RATING_KEY,
    mutationFn: ({ path, rating }: { path: string; rating: number }) =>
      coreRequest<SetRatingResult>("setRating", { shoot, path, rating }),
    onMutate: async ({ path, rating }) => {
      await queryClient.cancelQueries({ queryKey: ["images", shoot] });
      const previous = queryClient.getQueryData<ImageFile[]>(["images", shoot]);
      queryClient.setQueryData<ImageFile[]>(["images", shoot], (old) =>
        old?.map((image) =>
          image.path === path ? { ...image, rating } : image,
        ),
      );
      return { previous };
    },
    onError: (error, vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["images", shoot], context.previous);
      }
      toast.error(`Rating ${vars.path.split("/").pop()} failed`, {
        description: String(error),
      });
    },
    onSettled: () => {
      if (queryClient.isMutating({ mutationKey: SET_RATING_KEY }) === 1) {
        queryClient.invalidateQueries({ queryKey: ["images", shoot] });
      }
    },
  });
}

export type EditWrite = { path: string; edit: Edit };

/// Per path: a whole-list snapshot rolled back would take concurrent writes
/// down with the failed one.
function patchEdits(
  queryClient: QueryClient,
  shoot: string | null,
  edits: Map<string, Edit>,
) {
  queryClient.setQueryData<ImageFile[]>(["images", shoot], (old) =>
    old?.map((image) => {
      const edit = edits.get(image.path);
      return edit ? { ...image, edit } : image;
    }),
  );
}

function currentEdits(
  queryClient: QueryClient,
  shoot: string | null,
  paths: string[],
): Map<string, Edit> {
  const images = queryClient.getQueryData<ImageFile[]>(["images", shoot]) ?? [];
  const byPath = new Map(images.map((image) => [image.path, image.edit]));
  const wanted = new Map<string, Edit>();
  for (const path of paths) {
    const edit = byPath.get(path);
    if (edit) wanted.set(path, edit);
  }
  return wanted;
}

/// The core's queue runs eight wide with no per-file lock, so overlapping
/// writes to one photo can land in either order.
const writesByPath = new Map<string, Promise<unknown>>();

function writeInOrder<T>(path: string, write: () => Promise<T>): Promise<T> {
  const done = (writesByPath.get(path) ?? Promise.resolve()).then(write, write);
  const settled = done
    .catch(() => undefined)
    .then(() => {
      if (writesByPath.get(path) === settled) writesByPath.delete(path);
    });
  writesByPath.set(path, settled);
  return done;
}

const writeEdit = (shoot: string | null, { path, edit }: EditWrite) =>
  writeInOrder(path, () =>
    coreRequest<SetEditResult>("setEdit", { shoot, path, edit }),
  );

export function useSetEdit(shoot: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: SET_EDIT_KEY,
    mutationFn: (write: EditWrite) => writeEdit(shoot, write),
    onMutate: async ({ path, edit }) => {
      await queryClient.cancelQueries({ queryKey: ["images", shoot] });
      const previous = currentEdits(queryClient, shoot, [path]);
      patchEdits(queryClient, shoot, new Map([[path, edit]]));
      return { previous };
    },
    onError: (error, vars, context) => {
      if (context?.previous) patchEdits(queryClient, shoot, context.previous);
      toast.error(`Saving edits for ${vars.path.split("/").pop()} failed`, {
        description: String(error),
      });
    },
    onSettled: () => {
      if (queryClient.isMutating({ mutationKey: SET_EDIT_KEY }) === 1) {
        queryClient.invalidateQueries({ queryKey: ["images", shoot] });
      }
    },
  });
}

export type PasteResult = {
  written: number;
  failed: string[];
  overtaken: number;
};

/// Enough to keep exiftool busy without starving renders and thumbnails.
const PASTE_CONCURRENCY = 4;

/// One mutation for the batch, under the single-edit key so the library poller
/// leaves the images cache alone until every write has settled.
export function usePasteEdits(shoot: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: SET_EDIT_KEY,
    mutationFn: async (writes: EditWrite[]): Promise<PasteResult> => {
      const target = shoot;
      const failed: string[] = [];
      let overtaken = 0;
      let next = 0;
      const worker = async () => {
        while (next < writes.length) {
          const write = writes[next++];
          // Edited by hand since the batch started: that value is newer.
          const live = currentEdits(queryClient, target, [write.path]).get(
            write.path,
          );
          if (live && editKey(live) !== editKey(write.edit)) {
            overtaken += 1;
            continue;
          }
          try {
            await writeEdit(target, write);
          } catch {
            failed.push(write.path);
          }
        }
      };
      await Promise.all(
        Array.from(
          { length: Math.min(PASTE_CONCURRENCY, writes.length) },
          worker,
        ),
      );
      return {
        written: writes.length - failed.length - overtaken,
        failed,
        overtaken,
      };
    },
    // A long paste outlives its shoot, and react-query hands a running
    // mutation the latest options — so the shoot travels in the context.
    onMutate: async (writes) => {
      await queryClient.cancelQueries({ queryKey: ["images", shoot] });
      const previous = currentEdits(
        queryClient,
        shoot,
        writes.map((write) => write.path),
      );
      patchEdits(
        queryClient,
        shoot,
        new Map(writes.map((write) => [write.path, write.edit])),
      );
      return { previous, shoot };
    },
    onSuccess: (result, _writes, context) => {
      if (result.failed.length === 0) return;
      const rollback = new Map<string, Edit>();
      for (const path of result.failed) {
        const edit = context?.previous.get(path);
        if (edit) rollback.set(path, edit);
      }
      patchEdits(queryClient, context.shoot, rollback);
      toast.error(
        `${result.failed.length} ${
          result.failed.length === 1 ? "photo" : "photos"
        } kept the settings they had`,
        { description: "Saving failed" },
      );
    },
    onSettled: (_result, _error, _writes, context) => {
      if (queryClient.isMutating({ mutationKey: SET_EDIT_KEY }) === 1) {
        queryClient.invalidateQueries({
          queryKey: ["images", context?.shoot ?? shoot],
        });
      }
    },
  });
}

export function useReveal() {
  return useMutation({
    mutationKey: ["write", "reveal"],
    mutationFn: (paths: string[]) =>
      coreRequest<{ revealed: boolean }>("reveal", { paths }),
    onError: (error) => {
      toast.error("Could not reveal in Finder", { description: String(error) });
    },
  });
}

export function useTrash(shoot: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["write", "trash"],
    mutationFn: (paths: string[]) =>
      coreRequest<{ files: number; generation: number }>("trash", {
        shoot,
        paths,
      }),
    onSuccess: (result, paths) => {
      toast.success(
        `Moved ${paths.length} ${paths.length === 1 ? "photo" : "photos"} to the Trash`,
        { description: `${result.files} files` },
      );
      queryClient.invalidateQueries({ queryKey: ["images", shoot] });
      queryClient.invalidateQueries({ queryKey: ["shoots"] });
    },
    onError: (error) => {
      toast.error("Could not delete", { description: String(error) });
    },
  });
}

export function useUpdateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["write", "updateProject"],
    mutationFn: (vars: {
      shoot: string;
      notes?: string;
      cover?: string | null;
    }) => coreRequest<{ generation: number }>("updateProject", vars),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shoots"] });
    },
    onError: (error) => {
      toast.error("Could not save the project", { description: String(error) });
    },
  });
}

export function useRenameProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["write", "renameProject"],
    mutationFn: (vars: { shoot: string; day: string; name: string }) =>
      coreRequest<{ shoot: string; generation: number }>("renameProject", vars),
    onSuccess: (result) => {
      toast.success(`Renamed to ${result.shoot}`);
      queryClient.invalidateQueries({ queryKey: ["shoots"] });
      queryClient.invalidateQueries({ queryKey: ["images"] });
    },
    onError: (error) => {
      toast.error("Could not rename the project", {
        description: String(error),
      });
    },
  });
}

export function useImportFiles(shoot: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["write", "importFiles"],
    mutationFn: (paths: string[]) =>
      coreRequest<{ imported: number; skipped: number }>("importFiles", {
        shoot,
        paths,
      }),
    onSuccess: (result) => {
      toast.success(
        `Imported ${result.imported} ${result.imported === 1 ? "file" : "files"}`,
        {
          description:
            result.skipped > 0
              ? `${result.skipped} skipped (not photos)`
              : undefined,
        },
      );
      queryClient.invalidateQueries({ queryKey: ["images", shoot] });
      queryClient.invalidateQueries({ queryKey: ["scoring", shoot] });
      queryClient.invalidateQueries({ queryKey: ["shoots"] });
    },
    onError: (error) => {
      toast.error("Import failed", { description: String(error) });
    },
  });
}

export type ExportRequest = {
  shoot: string;
  paths: string[];
  destination: string;
  zip: boolean;
  flatten: boolean;
  format: ExportFormat;
  quality: number;
  decoderVersion: number;
};

export type ExportProgress = {
  id: string;
  done: number;
  failed: number;
  total: number;
  running: boolean;
  cancelled: boolean;
  archiving: boolean;
  error: string | null;
  failures: string[];
};

export type ExportJob = ExportProgress & {
  key: string;
  label: string;
  destination: string;
  startedAt: number;
};

export type JobStatus = "running" | "failed" | "partial" | "cancelled" | "done";

export function jobStatus(job: ExportJob): JobStatus {
  if (job.running) return "running";
  if (job.error) return "failed";
  if (job.cancelled) return "cancelled";
  // Two thirds of a delivery missing is not a success, and a green check is
  // how it goes unnoticed until the photos are wanted.
  return job.failed > 0 ? "partial" : "done";
}

const EXPORT_POLL_MS = 400;
let nextJobKey = 1;

/// Addressed by `key`, so a row outlives the core process that issued its `id`.
type JobRow = {
  key: string;
  id: string;
  label: string;
  destination: string;
  startedAt: number;
  initial: ExportProgress;
};

export function useExportJobs() {
  const client = useQueryClient();
  const [rows, setRows] = useState<JobRow[]>([]);

  const results = useQueries({
    queries: rows.map((row) => ({
      queryKey: ["export", row.key],
      queryFn: () =>
        coreRequest<ExportProgress>("exportStatus", { id: row.id }),
      initialData: row.initial,
      enabled: row.id !== "",
      refetchInterval: (query: { state: { data?: ExportProgress } }) =>
        query.state.data?.running ? EXPORT_POLL_MS : false,
      retry: false,
    })),
  });

  const jobs: ExportJob[] = rows.map((row, index) => {
    const result = results[index];
    const progress = result?.data ?? row.initial;
    // The core went away mid-export; this job is not coming back.
    const lost = result?.error
      ? { running: false, error: String(result.error) }
      : null;
    return { ...row, ...progress, ...lost };
  });
  const running = jobs.some((job) => job.running);

  const start = useCallback(async (label: string, request: ExportRequest) => {
    const key = String(nextJobKey++);
    const settled: ExportProgress = {
      id: "",
      done: 0,
      failed: 0,
      total: request.paths.length,
      running: false,
      cancelled: false,
      archiving: false,
      error: null,
      failures: [],
    };
    const row = {
      key,
      label,
      destination: request.destination,
      startedAt: Date.now(),
    };
    try {
      const job = await coreRequest<ExportProgress>("exportFiles", request);
      setRows((current) => [{ ...row, id: job.id, initial: job }, ...current]);
    } catch (error) {
      // A refusal the user can still read after the toast has gone.
      setRows((current) => [
        { ...row, id: "", initial: { ...settled, error: String(error) } },
        ...current,
      ]);
      toast.error("Could not start the export", { description: String(error) });
    }
  }, []);

  const cancel = useCallback(
    (key: string) => {
      const row = rows.find((candidate) => candidate.key === key);
      if (!row) return;
      coreRequest<ExportProgress>("cancelExport", { id: row.id })
        .then((update) => client.setQueryData(["export", key], update))
        .catch((error: unknown) => {
          toast.error("Could not cancel the export", {
            description: String(error),
          });
        });
    },
    [client, rows],
  );

  return { jobs, start, cancel, running };
}

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["write", "createProject"],
    mutationFn: (vars: { day: string; name: string; notes: string }) =>
      coreRequest<CreateProjectResult>("createProject", vars),
    onSuccess: (result) => {
      toast.success(`Created ${result.shoot}`);
      queryClient.invalidateQueries({ queryKey: ["shoots"] });
    },
    onError: (error) => {
      toast.error("Could not create the project", {
        description: String(error),
      });
    },
  });
}

export type ScanProgress = Pick<
  StatusResult,
  "scanning" | "filesFound" | "filesEnriched"
>;

const IDLE_POLL_MS = 2000;
/// The shoot list is cheap; per-shoot refetches are rate-limited by the core.
const INDEXING_POLL_MS = 250;

const NOT_SCANNING: ScanProgress = {
  scanning: false,
  filesFound: 0,
  filesEnriched: 0,
};

/// Polls faster while the core is still indexing, and refetches a shoot's
/// photos only when the core names that shoot as changed.
export function useLibrarySync(
  enabled: boolean,
  initialGeneration: number | null,
) {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<ScanProgress>(NOT_SCANNING);
  const seen = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      setProgress(NOT_SCANNING);
      return;
    }
    seen.current = initialGeneration;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;

    const poll = async () => {
      let next = IDLE_POLL_MS;
      try {
        const status = await coreRequest<StatusResult>("status", {
          since: seen.current,
        });
        if (stopped) return;
        setProgress(status);
        next = status.scanning ? INDEXING_POLL_MS : IDLE_POLL_MS;
        // A rating write in flight owns the images cache until it settles.
        if (
          status.generation !== seen.current &&
          xmpWritesInFlight(queryClient) === 0
        ) {
          queryClient.invalidateQueries({ queryKey: ["shoots"] });
          for (const shoot of status.changedShoots ?? []) {
            queryClient.invalidateQueries({ queryKey: ["images", shoot] });
            // newly arrived photos need rating, and only scoreShoot picks them up
            queryClient.invalidateQueries({ queryKey: ["scoring", shoot] });
          }
          seen.current = status.generation;
        }
      } catch {}
      if (!stopped) timer = setTimeout(poll, next);
    };

    // Straight away, so a library that opened mid-index says so on first paint.
    timer = setTimeout(poll, 0);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [enabled, initialGeneration, queryClient]);

  return progress;
}
