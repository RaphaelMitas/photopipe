import { useQueryClient } from "@tanstack/react-query";
import { ClipboardPaste, Star } from "lucide-react";
import { useCallback, useRef } from "react";
import { type Edit, editKey, type ImageFile, isRawFile } from "./core";
import { describeEdit } from "./describeEdit";
import { type HistoryAction, pushHistory } from "./history";
import {
  type EditWrite,
  type PasteResult,
  usePasteEdits,
  useSetEdit,
  useSetRating,
} from "./queries";

export function useRecordedWrites(shoot: string | null) {
  const queryClient = useQueryClient();
  const setRating = useSetRating(shoot);
  const setEdit = useSetEdit(shoot);
  const pasteEdits = usePasteEdits(shoot);
  // History entries outlive the render that made them.
  const live = useRef({ setRating, setEdit, pasteEdits });
  live.current = { setRating, setEdit, pasteEdits };

  const cached = useCallback(
    (path: string) =>
      queryClient
        .getQueryData<ImageFile[]>(["images", shoot])
        ?.find((image) => image.path === path),
    [queryClient, shoot],
  );

  const rate = useCallback(
    (path: string, rating: number) => {
      const image = cached(path);
      if (!image || image.rating === rating) return;
      const write = (value: number) =>
        live.current.setRating.mutateAsync({ path, rating: value });
      record(
        write,
        image.rating,
        rating,
        {
          icon: Star,
          label: "Rating",
          detail: rating === 0 ? "cleared" : "★".repeat(rating),
          paths: [path],
        },
        // before the core has read the file, the old rating is a placeholder
        image.enriched,
      );
    },
    [cached],
  );

  const writeEdit = useCallback(
    (path: string, edit: Edit) => {
      const image = cached(path);
      if (!image || editKey(image.edit) === editKey(edit)) return;
      const before = image.edit;
      const write = (value: Edit) =>
        live.current.setEdit.mutateAsync({ path, edit: value });
      record(write, before, edit, {
        ...describeEdit(before, edit, isRawFile(image)),
        paths: [path],
      });
    },
    [cached],
  );

  const paste = useCallback(
    (writes: EditWrite[]): Promise<PasteResult> => {
      const previous = writes.flatMap(({ path }) => {
        const edit = cached(path)?.edit;
        return edit ? [{ path, edit }] : [];
      });
      const among = (all: EditWrite[], paths: string[]) =>
        all.filter((write) => paths.includes(write.path));
      const batch = live.current.pasteEdits.mutateAsync(writes);
      // Recorded up front: ⌘Z during a long paste has to mean this paste.
      void pushHistory({
        icon: ClipboardPaste,
        label: "Paste settings",
        paths: writes.map((write) => write.path),
        undo: (paths) =>
          live.current.pasteEdits.mutateAsync(among(previous, paths)),
        redo: (paths) =>
          live.current.pasteEdits.mutateAsync(among(writes, paths)),
        written: batch.then((result) => {
          if (result.written === 0) throw new Error("nothing pasted");
        }),
      });
      return batch;
    },
    [cached],
  );

  return { rate, writeEdit, paste };
}

function record<T>(
  write: (value: T) => Promise<unknown>,
  before: T,
  after: T,
  action: Omit<HistoryAction, "undo" | "redo" | "written">,
  undoable = true,
) {
  const written = write(after);
  // the mutation's onError already rolls back and toasts
  void written.catch(() => {});
  if (!undoable) return;
  void pushHistory({
    ...action,
    undo: () => write(before),
    redo: () => write(after),
    written,
  });
}
