import { storedFlag } from "@/lib/stored";

export const dateInFolderDefault = storedFlag("photopipe.dateInFolder", true);

export type ProjectDraft = {
  name: string;
  day: string;
  dateInFolder: boolean;
  notes: string;
};

export function projectRequest(draft: ProjectDraft) {
  return { ...draft, day: draft.day || null };
}

export type ProjectRequest = ReturnType<typeof projectRequest>;

export function projectFolder({
  name,
  day,
  dateInFolder,
}: {
  name: string;
  day: string | null;
  dateInFolder: boolean;
}): string {
  const trimmed = name.trim();
  if (!trimmed) return "";
  return dateInFolder && day ? `${day}_${trimmed}` : trimmed;
}
