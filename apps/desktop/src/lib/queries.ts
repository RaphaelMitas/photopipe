import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import {
  coreRequest,
  type ImageGroup,
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
