import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import {
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
          maxPixel: 256,
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

/// Rating writes: optimistic (culling must feel instant), rolled back on
/// error. The core bumps its generation, so other views converge via the poll.
export function useSetRating(shoot: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
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
    onError: (_error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["images", shoot], context.previous);
      }
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
        if (status.generation !== lastGeneration.current) {
          queryClient.invalidateQueries({ queryKey: ["shoots"] });
          queryClient.invalidateQueries({ queryKey: ["images"] });
        }
        lastGeneration.current = status.generation;
      } catch {
        // Sidecar restarting — next tick will catch up.
      }
    }, intervalMs);
    return () => clearInterval(timer);
  }, [enabled, initialGeneration, intervalMs, queryClient]);
}
