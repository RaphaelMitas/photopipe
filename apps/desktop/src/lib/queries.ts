import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  type CreateProjectResult,
  coreRequest,
  type ImageGroup,
  type SetRatingResult,
  type Shoot,
  type StatusResult,
} from "./core";

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
      (await coreRequest<{ images: ImageGroup[] }>("listImages", { shoot }))
        .images,
    enabled: shoot !== null,
  });
}

/// Keyed on path + mtime: when an external change replaces a file, the
/// refreshed image list carries a new mtime and re-requests the thumbnail —
/// which is what lets `staleTime: Infinity` stay correct.
export function useThumbnail(
  file: { path: string; mtime: number } | undefined,
) {
  return useQuery({
    queryKey: ["thumb", file?.path, file?.mtime],
    queryFn: async () =>
      (
        await coreRequest<{ cachePath: string }>("thumbnail", {
          path: file?.path,
          // Justified cells run up to ~370px wide; 512 keeps retina sharp.
          maxPixel: 512,
        })
      ).cachePath,
    enabled: file !== undefined,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

type RenderFile = { path: string; mtime: number } | undefined;

function renderQueryOptions(file: RenderFile, exposure: number) {
  return {
    queryKey: ["render", file?.path, file?.mtime, exposure] as const,
    queryFn: async () =>
      (
        await coreRequest<{ cachePath: string }>("render", {
          path: file?.path,
          exposure,
          maxPixel: 2560,
        })
      ).cachePath,
    staleTime: Number.POSITIVE_INFINITY,
  };
}

/// Loupe render: raw-pipeline exposure happens core-side; the cache key is
/// (path, mtime, exposure). The placeholder keeps the last frame on screen
/// only while scrubbing the SAME image (continuous, no flicker) — navigating
/// to a different photo must never show the previous photo's pixels, so
/// there the caller falls back to the thumbnail instead.
export function useRender(file: RenderFile, exposure: number) {
  return useQuery({
    ...renderQueryOptions(file, exposure),
    enabled: file !== undefined,
    placeholderData: (previous: string | undefined, previousQuery) =>
      previousQuery?.queryKey[1] === file?.path ? previous : undefined,
  });
}

/// Warm the render cache for a neighbor image so ← → lands on ready pixels
/// instead of a cold multi-second raw decode.
export function usePrefetchRender(file: RenderFile, exposure: number) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!file) return;
    // No-op when already cached; the core dedups concurrent renders by key.
    queryClient.prefetchQuery(renderQueryOptions(file, exposure));
  }, [queryClient, file, exposure]);
}

export const SET_RATING_KEY = ["setRating"];

/// Rating writes: optimistic (culling must feel instant), rolled back on
/// error. Refetches are fenced while a rating burst is in flight — on the
/// concurrent sidecar a listImages can execute before the newest setRating
/// applies, and its stale snapshot would stomp the optimistic state — then a
/// single reconciling invalidation runs when the burst settles.
export function useSetRating(shoot: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: SET_RATING_KEY,
    mutationFn: ({ stem, rating }: { stem: string; rating: number }) =>
      coreRequest<SetRatingResult>("setRating", { shoot, stem, rating }),
    onMutate: async ({ stem, rating }) => {
      await queryClient.cancelQueries({ queryKey: ["images", shoot] });
      const previous = queryClient.getQueryData<ImageGroup[]>([
        "images",
        shoot,
      ]);
      queryClient.setQueryData<ImageGroup[]>(["images", shoot], (old) =>
        old?.map((image) =>
          image.stem === stem ? { ...image, rating } : image,
        ),
      );
      return { previous };
    },
    onError: (error, vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["images", shoot], context.previous);
      }
      // A rolled-back rating must never be silent — the core's error names
      // the actual cause (exiftool failure, unknown image, dead sidecar…).
      toast.error(`Rating ${vars.stem} failed`, {
        description: String(error),
      });
    },
    onSettled: () => {
      // Only the last mutation of a burst reconciles with the core.
      if (queryClient.isMutating({ mutationKey: SET_RATING_KEY }) === 1) {
        queryClient.invalidateQueries({ queryKey: ["images", shoot] });
      }
    },
  });
}

/// Hand files to another app. Which files depends on the page — the stage
/// pages pick the working file, Media sends whatever you selected — so the
/// caller resolves paths and the core just opens them.
export function useOpenIn() {
  return useMutation({
    mutationKey: ["write", "openIn"],
    mutationFn: ({
      paths,
      app,
    }: {
      paths: string[];
      app: string;
      label?: string;
    }) => coreRequest<{ opened: number }>("openIn", { paths, app }),
    onSuccess: (result, vars) => {
      toast.success(
        `Opened ${result.opened} ${result.opened === 1 ? "file" : "files"}${
          vars.label ? ` in ${vars.label}` : ""
        }`,
      );
    },
    onError: (error) => {
      toast.error("Could not open the files", { description: String(error) });
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

/// Delete means Trash — recoverable, never an unlink. Trashes the whole
/// lineage group and its XMP sidecars, because that is what "delete this
/// photo" means.
export function useTrash(shoot: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["write", "trash"],
    mutationFn: (stems: string[]) =>
      coreRequest<{ files: number; generation: number }>("trash", {
        shoot,
        stems,
      }),
    onSuccess: (result, stems) => {
      toast.success(
        `Moved ${stems.length} ${stems.length === 1 ? "photo" : "photos"} to the Trash`,
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

/// Copy outside files into a stage's folder. Every page can import: fresh
/// originals, or processed/edited results a tool saved somewhere else.
export function useImportFiles(shoot: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["write", "importFiles"],
    mutationFn: ({ stage, paths }: { stage: string; paths: string[] }) =>
      coreRequest<{ imported: number; skipped: number }>("importFiles", {
        shoot,
        stage,
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
      queryClient.invalidateQueries({ queryKey: ["shoots"] });
    },
    onError: (error) => {
      toast.error("Import failed", { description: String(error) });
    },
  });
}

/// Copy files to a folder, or zip them flat for handing over.
export function useExportFiles() {
  return useMutation({
    mutationKey: ["write", "exportFiles"],
    mutationFn: ({
      paths,
      destination,
      zip,
    }: {
      paths: string[];
      destination: string;
      zip: boolean;
    }) =>
      coreRequest<{ files: number }>("exportFiles", {
        paths,
        destination,
        zip,
      }),
    onSuccess: (result, vars) => {
      toast.success(
        `Exported ${result.files} ${result.files === 1 ? "file" : "files"}`,
        { description: vars.destination },
      );
    },
    onError: (error) => {
      toast.error("Export failed", { description: String(error) });
    },
  });
}

/// Create `<date>_<name>/raw/` plus the metadata file. The folder is the
/// project — nothing else is registered anywhere.
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

/// "Quick, not real-time": poll the core's generation counter and invalidate
/// list queries when external changes bumped it. Seed with the generation
/// `setRoot` returned so a change landing before the first tick still
/// invalidates instead of being silently recorded as the baseline.
export function useGenerationPoll(
  enabled: boolean,
  initialGeneration: number | null,
  intervalMs = 2000,
) {
  const queryClient = useQueryClient();
  const lastGeneration = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    lastGeneration.current = initialGeneration;
    const timer = setInterval(async () => {
      try {
        const status = await coreRequest<StatusResult>("status");
        if (status.generation === lastGeneration.current) return;
        // Rating burst in flight: a refetch now could race the concurrent
        // core and return a snapshot missing the newest writes. Leave
        // lastGeneration untouched so the next quiet tick reconciles.
        if (queryClient.isMutating({ mutationKey: SET_RATING_KEY }) > 0) {
          return;
        }
        queryClient.invalidateQueries({ queryKey: ["shoots"] });
        queryClient.invalidateQueries({ queryKey: ["images"] });
        lastGeneration.current = status.generation;
      } catch {
        // Sidecar restarting — next tick will catch up.
      }
    }, intervalMs);
    return () => clearInterval(timer);
  }, [enabled, initialGeneration, intervalMs, queryClient]);
}
