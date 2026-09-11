import type { Shoot } from "@/lib/core";
import { storedFlag } from "@/lib/stored";

export const dateInFolderDefault = storedFlag("photopipe.dateInFolder", true);

export function projectFolder(
  name: string,
  day: string | null,
  dateInFolder: boolean,
): string {
  const trimmed = name.trim();
  if (!trimmed) return "";
  return dateInFolder && day ? `${day}_${trimmed}` : trimmed;
}

export function hasDateInFolder(shoot: Shoot): boolean {
  return shoot.name !== shoot.project;
}
