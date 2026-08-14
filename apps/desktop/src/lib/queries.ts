import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  type CreateProjectResult,
  coreRequest,
  type Edit,
  type ExportFormat,
  editKey,
  type ImageFile,
  isRawFile,
  type SetEditResult,
  type SetRatingResult,
  type Shoot,
  type StatusResult,
  type WhiteBalanceResult,
} from "./core";

export function useAppVersion(enabled: boolean) {
  return useQuery({
    queryKey: ["appVersion"],
    queryFn: getVersion,
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

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
      (await coreRequest<{ images: ImageFile[] }>("listImages", { shoot }))
        .images,
    enabled: shoot !== null,
  });
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

type RenderFile = { path: string; mtime: number } | undefined;

function renderQueryOptions(file: RenderFile, edit: Edit) {
  return {
    queryKey: ["render", file?.path, file?.mtime, editKey(edit)] as const,
    queryFn: async () =>
      (
        await coreRequest<{ cachePath: string }>("render", {
          path: file?.path,
          edit,
          maxPixel: 2560,
        })
      ).cachePath,
    staleTime: Number.POSITIVE_INFINITY,
  };
}

export function useRender(file: RenderFile, edit: Edit) {
  return useQuery({
    ...renderQueryOptions(file, edit),
    enabled: file !== undefined,
    placeholderData: (previous: string | undefined, previousQuery) =>
      previousQuery?.queryKey[1] === file?.path ? previous : undefined,
  });
}

export function usePrefetchRender(file: RenderFile, edit: Edit | undefined) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!file || !edit) return;
    queryClient.prefetchQuery(renderQueryOptions(file, edit));
  }, [queryClient, file, edit]);
}

export function useWhiteBalance(
  file: { path: string; mtime: number; ext: string } | undefined,
) {
  return useQuery({
    queryKey: ["whiteBalance", file?.path, file?.mtime],
    queryFn: async () =>
      coreRequest<WhiteBalanceResult>("whiteBalance", { path: file?.path }),
    enabled: file !== undefined && isRawFile(file),
    staleTime: Number.POSITIVE_INFINITY,
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

export function useSetEdit(shoot: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: SET_EDIT_KEY,
    mutationFn: ({ path, edit }: { path: string; edit: Edit }) =>
      coreRequest<SetEditResult>("setEdit", { shoot, path, edit }),
    onMutate: async ({ path, edit }) => {
      await queryClient.cancelQueries({ queryKey: ["images", shoot] });
      const previous = queryClient.getQueryData<ImageFile[]>(["images", shoot]);
      queryClient.setQueryData<ImageFile[]>(["images", shoot], (old) =>
        old?.map((image) => (image.path === path ? { ...image, edit } : image)),
      );
      return { previous };
    },
    onError: (error, vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["images", shoot], context.previous);
      }
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
};

export function useExportFiles() {
  return useMutation({
    mutationKey: ["write", "exportFiles"],
    mutationFn: (request: ExportRequest) =>
      coreRequest<{ files: number }>("exportFiles", request),
  });
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
        if (xmpWritesInFlight(queryClient) > 0) {
          return;
        }
        queryClient.invalidateQueries({ queryKey: ["shoots"] });
        queryClient.invalidateQueries({ queryKey: ["images"] });
        lastGeneration.current = status.generation;
      } catch {}
    }, intervalMs);
    return () => clearInterval(timer);
  }, [enabled, initialGeneration, intervalMs, queryClient]);
}
