import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";

export type Features = { updater: boolean; zipExport: boolean };

const NONE: Features = { updater: false, zipExport: false };

export function useFeatures(): Features {
  const { data } = useQuery({
    queryKey: ["features"],
    queryFn: () => invoke<Features>("features"),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  return data ?? NONE;
}
