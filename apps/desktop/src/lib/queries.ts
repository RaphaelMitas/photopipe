import {
  type DefaultError,
  hashKey,
  keepPreviousData,
  MutationObserver,
  type MutationObserverOptions,
  type QueryClient,
  queryOptions,
  skipToken,
  useIsMutating,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  type CoreMethods,
  coreRequest,
  type Edit,
  type ExportProgress,
  editKey,
  type Flag,
  type ImageFile,
  normalizeEdit,
  normalizeImage,
  normalizeShoot,
  type StatusResult,
} from "./core";
import { fileName } from "./fileName";
import { pluralize } from "./plural";
import { useRawDecoderVersion } from "./rawDecoder";
import type { ViewportRequest } from "./zoom";

export function useShoots(enabled: boolean) {
  return useQuery({
    queryKey: ["shoots"],
    queryFn: async () =>
      (await coreRequest("listShoots")).shoots.map(normalizeShoot),
    enabled,
  });
}

const imagesKey = (shoot: string | null) => ["images", shoot];

function invalidateLibrary(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ["shoots"] });
  queryClient.invalidateQueries({ queryKey: DECODER_AVAILABILITY_KEY });
}

export function useImages(shoot: string | null) {
  return useQuery({
    queryKey: imagesKey(shoot),
    queryFn:
      shoot === null
        ? skipToken
        : async () =>
            (await coreRequest("listImages", { shoot })).images.map(
              normalizeImage,
            ),
  });
}

const RATED_OFFER_MS = 8000;

const PASSES = ["scoreShoot", "stackShoot"] as const;

/// Every fetch asks the core to run, which is what picks up new imports.
function usePass(
  method: (typeof PASSES)[number],
  shoot: string | null,
  enabled: boolean,
) {
  const client = useQueryClient();
  const wasRunning = useRef(false);
  const [endedAt, setEndedAt] = useState(0);

  const query = useQuery({
    queryKey: [method, shoot],
    queryFn: shoot === null ? skipToken : () => coreRequest(method, { shoot }),
    enabled,
    refetchInterval: (query) => (query.state.data?.running ? 1000 : false),
  });

  const running = query.data?.running ?? false;
  const lastShoot = useRef(shoot);
  useEffect(() => {
    const ended = wasRunning.current && !running;
    wasRunning.current = running;
    if (lastShoot.current !== shoot) {
      lastShoot.current = shoot;
      setEndedAt(0);
      return;
    }
    if (!ended) return;
    setEndedAt(Date.now());
    // photos that arrived while it ran were not part of it; asking again starts a pass for them
    void client.invalidateQueries({ queryKey: [method, shoot] });
    // a refetch landing mid-write would put pre-write ratings back; the last write refetches
    if (xmpWritesInFlight(client) > 0) markStale(client, shoot);
    else void client.invalidateQueries({ queryKey: imagesKey(shoot) });
  }, [running, shoot, client]);

  // a stale `running` would freeze a progress line where it stopped
  return { progress: enabled ? (query.data ?? null) : null, endedAt };
}

/// `justRated` is the window after a pass where the browser can hand the sort
/// over to Instinct.
export function useScoring(shoot: string | null, enabled: boolean) {
  const { progress, endedAt } = usePass("scoreShoot", shoot, enabled);
  const [justRated, setJustRated] = useState(false);
  useEffect(() => {
    setJustRated(endedAt > 0);
    if (endedAt === 0) return;
    const timer = setTimeout(() => setJustRated(false), RATED_OFFER_MS);
    return () => clearTimeout(timer);
  }, [endedAt]);
  return { progress, justRated };
}

// photos arriving mid-visit must not take a finished pass back
function useLatch(shoot: string | null, enabled: boolean, complete: boolean) {
  const [readyShoot, setReadyShoot] = useState<string | null>(null);
  useEffect(() => {
    // off, or a library switch, drops the latch: shoot names repeat across libraries
    if (!enabled) setReadyShoot(null);
    else if (complete) setReadyShoot(shoot);
  }, [enabled, complete, shoot]);
  return enabled && (complete || (readyShoot !== null && readyShoot === shoot));
}

/// Stacks are trusted once every listed photo carries one, which the core only
/// gives a photo it has analyzed; until then they would regroup under you.
export function useStacking(shoot: string | null, enabled: boolean) {
  const { progress } = usePass("stackShoot", shoot, enabled);
  const images = useImages(shoot).data;
  // the core cuts stacks by capture time, which only enrichment reads
  const complete =
    images !== undefined &&
    images.length > 0 &&
    images.every((image) => image.stack !== null && image.enriched);
  return { progress, ready: useLatch(shoot, enabled, complete) };
}

export function useEnriched(shoot: string | null, enabled: boolean) {
  const images = useImages(shoot).data;
  const complete = images?.every((image) => image.enriched) ?? false;
  return useLatch(shoot, enabled, complete);
}

export function useThumbnail(
  file: { path: string; mtime: number } | undefined,
) {
  return useQuery({
    queryKey: ["thumb", file?.path, file?.mtime],
    queryFn: file
      ? async () =>
          (await coreRequest("thumbnail", { path: file.path, maxPixel: 512 }))
            .cachePath
      : skipToken,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

type RenderFile = Pick<ImageFile, "path" | "mtime" | "isRaw"> | undefined;

const PREVIEW_MAX_PIXEL = 2560;

const superseded = (error: unknown) => String(error).startsWith("superseded");
// The split's before keeps its key through a slider drag, whose renders can drop it any number of times.
const renderRetry = (failures: number, error: unknown) =>
  superseded(error) || failures < 3;

function renderDecoderVersion(file: RenderFile, version: number) {
  return file?.isRaw ? version : undefined;
}

function renderQueryOptions(
  file: RenderFile,
  edit: Edit,
  maxPixel: number,
  viewport?: ViewportRequest["viewport"],
  decoderVersion?: number,
) {
  return queryOptions({
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
    ],
    queryFn: file
      ? async () =>
          (
            await coreRequest("render", {
              path: file.path,
              edit,
              maxPixel,
              ...(viewport ? { viewport } : {}),
              ...(decoderVersion ? { decoderVersion } : {}),
            })
          ).cachePath
      : skipToken,
    staleTime: Number.POSITIVE_INFINITY,
    retry: renderRetry,
    retryDelay: (failures, error) =>
      superseded(error) ? 0 : 1000 * 2 ** failures,
  });
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
    placeholderData: (previous: string | undefined, previousQuery) =>
      previousQuery?.queryKey[1] === file?.path ? previous : undefined,
  });
}

/// A photo you step to renders with its own edit at once; only slider drags lag.
export function useDeferredEdit(file: RenderFile, edit: Edit) {
  const deferredEdit = useDeferredValue(edit);
  const deferredPath = useDeferredValue(file?.path);
  return deferredPath === file?.path ? deferredEdit : edit;
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
    enabled: request !== null,
  });
}

export function usePrefetchRender(file: RenderFile, edit: Edit | undefined) {
  const queryClient = useQueryClient();
  const decoder = useRawDecoderVersion();
  useEffect(() => {
    if (!file || !edit) return;
    const options = renderQueryOptions(
      file,
      edit,
      PREVIEW_MAX_PIXEL,
      undefined,
      renderDecoderVersion(file, decoder),
    );
    // prefetching an in-flight query would re-enable the retries its last observer cancelled
    if (queryClient.getQueryState(options.queryKey)?.fetchStatus === "fetching")
      return;
    queryClient.prefetchQuery({
      ...options,
      // the loupe may land on it mid-flight and inherit this fetch's retry
      retry: (failures, error) =>
        renderRetry(failures, error) &&
        (queryClient
          .getQueryCache()
          .find({ queryKey: options.queryKey })
          ?.getObserversCount() ?? 0) > 0,
    });
  }, [queryClient, file, edit, decoder]);
}

export function useRawDefaults(file: RenderFile) {
  const decoderVersion = useRawDecoderVersion();
  return useQuery({
    queryKey: ["rawDefaults", file?.path, file?.mtime, decoderVersion],
    queryFn: file?.isRaw
      ? () => coreRequest("rawDefaults", { path: file.path, decoderVersion })
      : skipToken,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/// one header read per photo off an SD card; a whole shoot outruns the request timeout
const SUPPORT_BATCH = 400;

async function decoderSupport(paths: string[]) {
  const total = { raw9: 0, rawTotal: 0 };
  for (let start = 0; start < paths.length; start += SUPPORT_BATCH) {
    const batch = await coreRequest("decoderSupport", {
      paths: paths.slice(start, start + SUPPORT_BATCH),
    });
    total.raw9 += batch.raw9;
    total.rawTotal += batch.rawTotal;
  }
  return total;
}

// support is per camera model and OS, so it cannot change during the session
export function useDecoderSupport(paths: string[], enabled: boolean) {
  // sorted so the key is the selection's contents, not the grid's order
  const sorted = useMemo(() => [...paths].sort(), [paths]);
  return useQuery({
    queryKey: ["decoderSupport", sorted],
    queryFn: () => decoderSupport(sorted),
    enabled: enabled && sorted.length > 0,
    staleTime: Number.POSITIVE_INFINITY,
    // an unanswered probe reads as "RAW 9 is fine", so hold the last verdict;
    // it describes the previous selection, so callers check isPlaceholderData
    placeholderData: keepPreviousData,
  });
}

const DECODER_AVAILABILITY_KEY = ["decoderAvailability"];

/// null when nothing in the library could answer, so callers stay quiet
/// instead of claiming RAW 9 is missing.
export function useRaw9Availability(enabled: boolean) {
  return useQuery({
    queryKey: DECODER_AVAILABILITY_KEY,
    queryFn: async () =>
      (await coreRequest("decoderAvailability")).raw9 ?? null,
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

const SET_RATING_KEY = ["setRating"];
const SET_FLAG_KEY = ["setFlag"];
const TRASH_KEY = ["write", "trash"];
const SET_EDIT_KEY = ["setEdit"];

const XMP_WRITE_KEYS = [SET_RATING_KEY, SET_FLAG_KEY, SET_EDIT_KEY];

function xmpWritesInFlight(queryClient: QueryClient): number {
  return XMP_WRITE_KEYS.reduce(
    (sum, mutationKey) => sum + queryClient.isMutating({ mutationKey }),
    0,
  );
}

/// A failed write or a list fetched during a write: refetch that shoot once the burst ends.
const staleLists = new WeakMap<QueryClient, Set<string | null>>();

function markStale(queryClient: QueryClient, shoot: string | null) {
  const shoots = staleLists.get(queryClient) ?? new Set();
  staleLists.set(queryClient, shoots.add(shoot));
}

function markFetching(queryClient: QueryClient, shoot: string | null) {
  if (queryClient.isFetching({ queryKey: imagesKey(shoot) }) > 0) {
    markStale(queryClient, shoot);
  }
}

async function holdImages(queryClient: QueryClient, shoot: string | null) {
  markFetching(queryClient, shoot);
  await queryClient.cancelQueries({ queryKey: imagesKey(shoot) });
}

// Waits for the last write, or the refetch could land over one still in flight.
function releaseImages(queryClient: QueryClient) {
  if (xmpWritesInFlight(queryClient) !== 1) return;
  for (const shoot of staleLists.get(queryClient) ?? []) {
    queryClient.invalidateQueries({ queryKey: imagesKey(shoot) });
  }
  staleLists.delete(queryClient);
}

export function cachedImage(
  queryClient: QueryClient,
  shoot: string | null,
  path: string,
) {
  return queryClient
    .getQueryData<ImageFile[]>(imagesKey(shoot))
    ?.find((image) => image.path === path);
}

/// Per path: a whole-list snapshot rolled back would take concurrent writes
/// down with the failed one.
function patchImages(
  queryClient: QueryClient,
  shoot: string | null,
  patches: Map<string, Partial<ImageFile>>,
) {
  queryClient.setQueryData<ImageFile[]>(imagesKey(shoot), (old) =>
    old?.map((image) => {
      const patch = patches.get(image.path);
      return patch ? { ...image, ...patch } : image;
    }),
  );
}

const patchImage = (
  queryClient: QueryClient,
  shoot: string | null,
  path: string,
  patch: Partial<ImageFile>,
) => patchImages(queryClient, shoot, new Map([[path, patch]]));

export function currentEdits(
  queryClient: QueryClient,
  shoot: string | null,
  paths: string[],
): Map<string, Edit> {
  const images = queryClient.getQueryData<ImageFile[]>(imagesKey(shoot)) ?? [];
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

/// Resolves to null when a newer write to the photo is already queued: that
/// one's answer is the one the cache should end on.
function writeInOrder<T>(
  path: string,
  write: () => Promise<T>,
): Promise<T | null> {
  const run = async (): Promise<T | null> => {
    const answer = await write();
    return writesByPath.get(path) === settled ? answer : null;
  };
  const done = (writesByPath.get(path) ?? Promise.resolve()).then(run, run);
  const settled = done
    .catch(() => undefined)
    .then(() => {
      if (writesByPath.get(path) === settled) writesByPath.delete(path);
    });
  writesByPath.set(path, settled);
  return done;
}

type PhotoField<V> = {
  mutationKey: string[];
  of: (image: ImageFile) => V;
  same: (a: V, b: V) => boolean;
  patch: (value: V) => Partial<ImageFile>;
  write: (shoot: string | null, path: string, value: V) => Promise<V | null>;
  failedOne: (path: string) => string;
  failedMany: (count: number) => string;
};

const RATING_FIELD: PhotoField<number> = {
  mutationKey: SET_RATING_KEY,
  of: (image) => image.rating,
  same: (a, b) => a === b,
  patch: (rating) => ({ rating }),
  write: (shoot, path, rating) =>
    writeInOrder(
      path,
      async () =>
        (await coreRequest("setRating", { shoot, path, rating })).rating,
    ),
  failedOne: (path) => `Rating ${fileName(path)} failed`,
  failedMany: (count) =>
    `${pluralize(count, "photo")} kept the rating they had`,
};

const FLAG_FIELD: PhotoField<Flag> = {
  mutationKey: SET_FLAG_KEY,
  of: (image) => image.flag,
  same: (a, b) => a === b,
  patch: (flag) => ({ flag }),
  write: (shoot, path, flag) =>
    writeInOrder(
      path,
      async () => (await coreRequest("setFlag", { shoot, path, flag })).flag,
    ),
  failedOne: (path) => `Flagging ${fileName(path)} failed`,
  failedMany: (count) => `${pluralize(count, "photo")} kept the flag they had`,
};

const EDIT_FIELD: PhotoField<Edit> = {
  mutationKey: SET_EDIT_KEY,
  of: (image) => image.edit,
  same: (a, b) => editKey(a) === editKey(b),
  patch: (edit) => ({ edit }),
  write: (shoot, path, edit) =>
    writeInOrder(path, async () =>
      normalizeEdit((await coreRequest("setEdit", { shoot, path, edit })).edit),
    ),
  failedOne: (path) => `Saving edits for ${fileName(path)} failed`,
  failedMany: (count) =>
    `${pluralize(count, "photo")} kept the settings they had`,
};

function cachedValue<V>(
  queryClient: QueryClient,
  shoot: string | null,
  path: string,
  field: PhotoField<V>,
): V | undefined {
  const image = cachedImage(queryClient, shoot, path);
  return image && field.of(image);
}

async function writeField<V>(
  queryClient: QueryClient,
  shoot: string | null,
  path: string,
  field: PhotoField<V>,
  value: V,
) {
  const written = await field.write(shoot, path, value);
  if (written !== null) {
    patchImage(queryClient, shoot, path, field.patch(written));
  }
  markFetching(queryClient, shoot);
}

/// `useMutation` minus the subscription, which re-renders App on every write's state change.
function useMutate<TData, TVariables, TOnMutateResult>(
  options: MutationObserverOptions<
    TData,
    DefaultError,
    TVariables,
    TOnMutateResult
  >,
) {
  const queryClient = useQueryClient();
  const [observer] = useState(() => new MutationObserver(queryClient, options));
  useEffect(() => observer.setOptions(options), [observer, options]);
  useEffect(() => () => observer.reset(), [observer]);
  return observer.mutate;
}

function useFieldWrite<V>(shoot: string | null, field: PhotoField<V>) {
  const queryClient = useQueryClient();
  return useMutate({
    mutationKey: field.mutationKey,
    mutationFn: ({ path, value }: { path: string; value: V }) =>
      writeField(queryClient, shoot, path, field, value),
    onMutate: async (vars) => {
      await holdImages(queryClient, shoot);
      const previous = cachedValue(queryClient, shoot, vars.path, field);
      patchImage(queryClient, shoot, vars.path, field.patch(vars.value));
      return { previous };
    },
    onSettled: (_data, error) => {
      if (error) markStale(queryClient, shoot);
      releaseImages(queryClient);
    },
    onError: (error, vars, context) => {
      if (context?.previous !== undefined) {
        patchImage(
          queryClient,
          shoot,
          vars.path,
          field.patch(context.previous),
        );
      }
      toast.error(field.failedOne(vars.path), { description: String(error) });
    },
  });
}

export const useSetRating = (shoot: string | null) =>
  useFieldWrite(shoot, RATING_FIELD);

export const useSetFlag = (shoot: string | null) =>
  useFieldWrite(shoot, FLAG_FIELD);

export const useSetEdit = (shoot: string | null) =>
  useFieldWrite(shoot, EDIT_FIELD);

export type BatchResult = {
  written: number;
  failed: string[];
  overtaken: number;
};

/// Enough to keep exiftool busy without starving renders and thumbnails.
const BATCH_CONCURRENCY = 4;

/// One mutation for the batch, under the single-write key so the library poller
/// leaves the images cache alone until every write has settled.
function useBatchWrite<V>(shoot: string | null, field: PhotoField<V>) {
  const queryClient = useQueryClient();
  return useMutate({
    mutationKey: field.mutationKey,
    mutationFn: async (values: Map<string, V>): Promise<BatchResult> => {
      // A long batch outlives its shoot, so it keeps the one it started with.
      const target = shoot;
      const live = (path: string) =>
        cachedValue(queryClient, target, path, field);
      await holdImages(queryClient, target);
      const previous = new Map<string, V>();
      const patches = new Map<string, Partial<ImageFile>>();
      for (const [path, value] of values) {
        const before = live(path);
        if (before !== undefined) previous.set(path, before);
        patches.set(path, field.patch(value));
      }
      patchImages(queryClient, target, patches);

      const queue = values.entries();
      const failed: string[] = [];
      let overtaken = 0;
      const worker = async () => {
        for (const [path, value] of queue) {
          // Changed by hand since the batch started: that value is newer. A
          // refetch putting the old value back is not a hand change.
          const now = live(path);
          const before = previous.get(path);
          const untouched =
            now === undefined ||
            field.same(now, value) ||
            (before !== undefined && field.same(now, before));
          if (!untouched) {
            overtaken += 1;
            continue;
          }
          try {
            await writeField(queryClient, target, path, field, value);
          } catch {
            failed.push(path);
            if (before !== undefined) {
              patchImage(queryClient, target, path, field.patch(before));
            }
          }
        }
      };
      await Promise.all(
        Array.from(
          { length: Math.min(BATCH_CONCURRENCY, values.size) },
          worker,
        ),
      );
      if (failed.length > 0) {
        markStale(queryClient, target);
        toast.error(field.failedMany(failed.length), {
          description: "Saving failed",
        });
      }
      releaseImages(queryClient);
      return {
        written: values.size - failed.length - overtaken,
        failed,
        overtaken,
      };
    },
  });
}

export const usePasteEdits = (shoot: string | null) =>
  useBatchWrite(shoot, EDIT_FIELD);

export const useSetRatings = (shoot: string | null) =>
  useBatchWrite(shoot, RATING_FIELD);

export const useSetFlags = (shoot: string | null) =>
  useBatchWrite(shoot, FLAG_FIELD);

// an undo still waiting on a write could un-reject a photo already in the Trash
const TRASH_BLOCKERS = new Set([...XMP_WRITE_KEYS, TRASH_KEY].map(hashKey));

export const useTrashBlocked = () =>
  useIsMutating({
    predicate: ({ options }) =>
      options.mutationKey !== undefined &&
      TRASH_BLOCKERS.has(hashKey(options.mutationKey)),
  }) > 0;

export function useReveal() {
  return useMutation({
    mutationKey: ["write", "reveal"],
    mutationFn: (paths: string[]) => revealItemInDir(paths),
    onError: (error) => {
      toast.error("Could not reveal in Finder", { description: String(error) });
    },
  });
}

export function useTrash(shoot: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: TRASH_KEY,
    mutationFn: (paths: string[]) => coreRequest("trash", { shoot, paths }),
    onSuccess: (result, paths) => {
      toast.success(`Moved ${pluralize(paths.length, "photo")} to the Trash`, {
        description: pluralize(result.files, "file"),
      });
      queryClient.invalidateQueries({ queryKey: imagesKey(shoot) });
      invalidateLibrary(queryClient);
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
    mutationFn: (vars: CoreMethods["updateProject"]["params"]) =>
      coreRequest("updateProject", vars),
    onSuccess: (result, vars) => {
      if (result.shoot !== vars.shoot) {
        toast.success(`Renamed to ${result.shoot}`);
        queryClient.invalidateQueries({ queryKey: ["images"] });
      }
      invalidateLibrary(queryClient);
    },
    onError: (error) => {
      toast.error("Could not save the project", { description: String(error) });
    },
  });
}

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

/// Addressed by `key`: every start that failed shares the empty `id`.
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
      queryFn: () => coreRequest("exportStatus", { id: row.id }),
      initialData: row.initial,
      enabled: row.id !== "",
      refetchInterval: (query: { state: { data?: ExportProgress } }) =>
        query.state.data?.running ? EXPORT_POLL_MS : false,
      retry: false,
    })),
  });

  const jobs: ExportJob[] = rows.map((row, index) => ({
    ...row,
    ...(results[index]?.data ?? row.initial),
  }));
  const running = jobs.some((job) => job.running);

  const start = useCallback(
    async (
      job:
        | {
            method: "exportFiles";
            label: string;
            request: CoreMethods["exportFiles"]["params"];
          }
        | {
            method: "importFiles";
            label: string;
            destination: string;
            request: CoreMethods["importFiles"]["params"];
          },
    ): Promise<ExportProgress | null> => {
      const { method, label, request } = job;
      const key = String(nextJobKey++);
      const settled: ExportProgress = {
        id: "",
        done: 0,
        failed: 0,
        total: request.paths.length,
        running: false,
        cancelled: false,
        archiving: false,
        failures: [],
      };
      const row = {
        key,
        label,
        destination:
          job.method === "exportFiles"
            ? job.request.destination
            : job.destination,
        startedAt: Date.now(),
      };
      try {
        const started = await coreRequest(method, request);
        setRows((current) => [
          { ...row, id: started.id, initial: started },
          ...current,
        ]);
        return started;
      } catch (error) {
        // A refusal the user can still read after the toast has gone.
        setRows((current) => [
          { ...row, id: "", initial: { ...settled, error: String(error) } },
          ...current,
        ]);
        const kind = method === "importFiles" ? "import" : "export";
        toast.error(`Could not start the ${kind}`, {
          description: String(error),
        });
        return null;
      }
    },
    [],
  );

  const cancel = useCallback(
    (key: string) => {
      const row = rows.find((candidate) => candidate.key === key);
      if (!row) return;
      coreRequest("cancelExport", { id: row.id })
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
    mutationFn: (vars: CoreMethods["createProject"]["params"]) =>
      coreRequest("createProject", vars),
    onSuccess: (result) => {
      toast.success(`Created ${result.shoot}`);
      invalidateLibrary(queryClient);
    },
    onError: (error) => {
      toast.error("Could not create the project", {
        description: String(error),
      });
    },
  });
}

export function useCaptureDate() {
  return useMutation({
    mutationFn: (path: string) => coreRequest("captureDate", { path }),
    onError: (error) => {
      toast.error("Could not read the photo's date", {
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
/// photos only when the core names that shoot as changed. `refresh` walks the
/// library again, which on iPadOS is the only way to see files added from outside.
export function useLibrarySync(
  enabled: boolean,
  initialGeneration: number | null,
) {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<ScanProgress>(NOT_SCANNING);
  const seen = useRef<number | null>(null);
  const pollNow = useRef(() => {});
  const rescan = useMutation({
    mutationFn: () => coreRequest("rescan"),
    // one walk at a time, so tapping refresh on a hung drive cannot pile them up
    scope: { id: "rescan" },
    onSettled: () => pollNow.current(),
    onError: (error) => {
      toast.error("Could not refresh the library", {
        description: String(error),
      });
    },
  });
  const { mutate } = rescan;

  useEffect(() => {
    if (!enabled) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") mutate();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [enabled, mutate]);

  useEffect(() => {
    if (!enabled) {
      setProgress(NOT_SCANNING);
      return;
    }
    seen.current = initialGeneration;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    let polling = false;
    let again = false;

    const poll = async () => {
      polling = true;
      let next = IDLE_POLL_MS;
      try {
        const status = await coreRequest("status", { since: seen.current });
        if (stopped) return;
        setProgress(status);
        next = status.scanning ? INDEXING_POLL_MS : IDLE_POLL_MS;
        // A rating write in flight owns the images cache until it settles.
        if (
          status.generation !== seen.current &&
          xmpWritesInFlight(queryClient) === 0
        ) {
          invalidateLibrary(queryClient);
          for (const shoot of status.changedShoots ?? []) {
            queryClient.invalidateQueries({ queryKey: imagesKey(shoot) });
            // newly arrived photos need a score and a print, and only the passes pick them up
            for (const method of PASSES) {
              queryClient.invalidateQueries({ queryKey: [method, shoot] });
            }
          }
          seen.current = status.generation;
        }
      } catch {}
      polling = false;
      if (!stopped) timer = setTimeout(poll, again ? 0 : next);
      again = false;
    };
    pollNow.current = () => {
      if (polling) {
        again = true;
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(poll, 0);
    };

    // Straight away, so a library that opened mid-index says so on first paint.
    timer = setTimeout(poll, 0);
    return () => {
      stopped = true;
      clearTimeout(timer);
      pollNow.current = () => {};
    };
  }, [enabled, initialGeneration, queryClient]);

  const refresh = useCallback(() => {
    if (enabled) mutate();
  }, [enabled, mutate]);

  return { progress, refresh, refreshing: rescan.isPending };
}
