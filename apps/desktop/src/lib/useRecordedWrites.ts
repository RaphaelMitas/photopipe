import { useQueryClient } from "@tanstack/react-query";
import { ClipboardPaste, Star } from "lucide-react";
import { useCallback, useMemo } from "react";
import { type Edit, editKey, isRawFile } from "./core";
import { describeEdit } from "./describeEdit";
import { historyChannel } from "./history";
import {
  type BatchResult,
  cachedImage,
  currentEdits,
  type EditWrite,
  usePasteEdits,
  useSetEdit,
  useSetRating,
  useSetRatings,
} from "./queries";

// a batch resolves even when every write failed; overtaken photos are not failures
const landed = (batch: Promise<BatchResult>) =>
  batch.then((result) => {
    if (result.written === 0 && result.failed.length > 0) {
      throw new Error("nothing written");
    }
  });

export function useRecordedWrites(shoot: string | null) {
  const queryClient = useQueryClient();
  // stable across renders, so an entry can hold on to them
  const { mutateAsync: setRating } = useSetRating(shoot);
  const { mutateAsync: setRatings } = useSetRatings(shoot);
  const { mutateAsync: setEdit } = useSetEdit(shoot);
  const { mutateAsync: pasteEdits } = usePasteEdits(shoot);

  const ratings = useMemo(
    () =>
      historyChannel((values: Map<string, number>) =>
        landed(setRatings(values)),
      ),
    [setRatings],
  );
  const edits = useMemo(
    () =>
      historyChannel((values: Map<string, Edit>) => landed(pasteEdits(values))),
    [pasteEdits],
  );

  const rate = useCallback(
    (path: string, rating: number) => {
      const image = cachedImage(queryClient, shoot, path);
      if (!image || image.rating === rating) return;
      const written = setRating({ path, rating });
      // the mutation already rolled back and toasted; the channel drops the entry
      void written.catch(() => {});
      // before the core has read the file, the old rating is a placeholder
      if (!image.enriched) return;
      void ratings.record(
        {
          icon: Star,
          label: "Rating",
          detail: rating === 0 ? "cleared" : "★".repeat(rating),
          paths: [path],
          written,
        },
        new Map([[path, image.rating]]),
        new Map([[path, rating]]),
      );
    },
    [queryClient, shoot, setRating, ratings],
  );

  const writeEdit = useCallback(
    (path: string, edit: Edit) => {
      const image = cachedImage(queryClient, shoot, path);
      if (!image || editKey(image.edit) === editKey(edit)) return;
      const written = setEdit({ path, edit });
      void written.catch(() => {});
      void edits.record(
        {
          ...describeEdit(image.edit, edit, isRawFile(image)),
          paths: [path],
          written,
        },
        new Map([[path, image.edit]]),
        new Map([[path, edit]]),
      );
    },
    [queryClient, shoot, setEdit, edits],
  );

  const paste = useCallback(
    (writes: EditWrite[]): Promise<BatchResult> => {
      const pasted = new Map(writes.map((write) => [write.path, write.edit]));
      const batch = pasteEdits(pasted);
      // Recorded up front: ⌘Z during a long paste has to mean this paste.
      void edits.record(
        {
          icon: ClipboardPaste,
          label: "Paste settings",
          paths: [...pasted.keys()],
          written: batch.then((result) => {
            if (result.written === 0) throw new Error("nothing pasted");
          }),
        },
        currentEdits(queryClient, shoot, [...pasted.keys()]),
        pasted,
      );
      return batch;
    },
    [queryClient, shoot, pasteEdits, edits],
  );

  return { rate, writeEdit, paste };
}
