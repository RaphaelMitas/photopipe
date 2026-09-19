import { useQueryClient } from "@tanstack/react-query";
import { ClipboardPaste, Star } from "lucide-react";
import { useCallback } from "react";
import { type Edit, editKey, isRawFile } from "./core";
import { describeEdit } from "./describeEdit";
import { type HistoryAction, pushHistory } from "./history";
import {
  cachedImage,
  currentEdits,
  type EditWrite,
  type PasteResult,
  usePasteEdits,
  useSetEdit,
  useSetRating,
} from "./queries";

export function useRecordedWrites(shoot: string | null) {
  const queryClient = useQueryClient();
  // stable across renders, so an entry can hold on to them
  const { mutateAsync: setRating } = useSetRating(shoot);
  const { mutateAsync: setEdit } = useSetEdit(shoot);
  const { mutateAsync: pasteEdits } = usePasteEdits(shoot);

  const rate = useCallback(
    (path: string, rating: number) => {
      const image = cachedImage(queryClient, shoot, path);
      if (!image || image.rating === rating) return;
      const write = (value: number) => setRating({ path, rating: value });
      // before the core has read the file, the old rating is a placeholder
      if (!image.enriched) return void write(rating).catch(() => {});
      record(write, image.rating, rating, {
        icon: Star,
        label: "Rating",
        detail: rating === 0 ? "cleared" : "★".repeat(rating),
        paths: [path],
      });
    },
    [queryClient, shoot, setRating],
  );

  const writeEdit = useCallback(
    (path: string, edit: Edit) => {
      const image = cachedImage(queryClient, shoot, path);
      if (!image || editKey(image.edit) === editKey(edit)) return;
      const before = image.edit;
      const write = (value: Edit) => setEdit({ path, edit: value });
      record(write, before, edit, {
        ...describeEdit(before, edit, isRawFile(image)),
        paths: [path],
      });
    },
    [queryClient, shoot, setEdit],
  );

  const paste = useCallback(
    (writes: EditWrite[]): Promise<PasteResult> => {
      const paths = writes.map((write) => write.path);
      const previous = Array.from(
        currentEdits(queryClient, shoot, paths),
        ([path, edit]) => ({ path, edit }),
      );
      // The batch resolves even when every write failed; a step must not.
      const landed = (batch: Promise<PasteResult>) =>
        batch.then((result) => {
          if (result.written === 0) throw new Error("nothing pasted");
        });
      const among = (all: EditWrite[], left: string[]) =>
        pasteEdits(all.filter((write) => left.includes(write.path)));
      const batch = pasteEdits(writes);
      // Recorded up front: ⌘Z during a long paste has to mean this paste.
      void pushHistory({
        icon: ClipboardPaste,
        label: "Paste settings",
        paths,
        undo: (left) => landed(among(previous, left)),
        redo: (left) => landed(among(writes, left)),
        written: landed(batch),
      });
      return batch;
    },
    [queryClient, shoot, pasteEdits],
  );

  return { rate, writeEdit, paste };
}

// pushHistory takes `written`'s failure: the mutation already rolled back and toasted
function record<T>(
  write: (value: T) => Promise<unknown>,
  before: T,
  after: T,
  action: Omit<HistoryAction, "undo" | "redo" | "written">,
) {
  void pushHistory({
    ...action,
    undo: () => write(before),
    redo: () => write(after),
    written: write(after),
  });
}
