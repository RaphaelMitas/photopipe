import { storedFlag } from "@/lib/storedFlag";

export const dateInFolderDefault = storedFlag("photopipe.dateInFolder", true);

export function projectFolder(
  name: string,
  day: string | null,
  dateInFolder: boolean,
): string {
  const trimmed = name.trim();
  return dateInFolder && day ? `${day}_${trimmed}` : trimmed;
}
