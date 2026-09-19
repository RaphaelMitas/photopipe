import { useQueryClient } from "@tanstack/react-query";
import { ClipboardPaste, Star } from "lucide-react";
import { useCallback, useRef } from "react";
import { type Edit, editKey, type ImageFile } from "./core";
import { describeEdit } from "./describeEdit";
import { type HistoryAction, historyEpoch, pushHistory } from "./history";
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
      record(write, image.rating, rating, {
        icon: Star,
        label: "Rating",
        detail: rating === 0 ? "cleared" : "★".repeat(rating),
        paths: [path],
        // before the core has read the file, the old rating is a placeholder
        undoable: image.enriched,
      });
    },
    [cached],
  );

  const writeEdit = useCallback(
    (path: string, edit: Edit) => {
      const before = cached(path)?.edit;
      if (!before || editKey(before) === editKey(edit)) return;
      const write = (value: Edit) =>
        live.current.setEdit.mutateAsync({ path, edit: value });
      record(write, before, edit, {
        ...describeEdit(before, edit),
        paths: [path],
        undoable: true,
      });
    },
    [cached],
  );

  const paste = useCallback(
    async (writes: EditWrite[]): Promise<PasteResult> => {
      const since = historyEpoch();
      const before = new Map(
        writes.map(({ path }) => [path, cached(path)?.edit]),
      );
      const result = await live.current.pasteEdits.mutateAsync(writes);
      // Photos the batch skipped or failed on never took the paste.
      const written = new Set(result.written);
      const pasted = writes.filter((write) => written.has(write.path));
      const previous = pasted.flatMap(({ path }) => {
        const edit = before.get(path);
        return edit ? [{ path, edit }] : [];
      });
      if (previous.length === 0) return result;
      void pushHistory(
        {
          icon: ClipboardPaste,
          label: "Paste settings",
          paths: previous.map((write) => write.path),
          undo: () => live.current.pasteEdits.mutateAsync(previous),
          redo: () => live.current.pasteEdits.mutateAsync(pasted),
        },
        since,
      );
      return result;
    },
    [cached],
  );

  return { rate, writeEdit, paste };
}

function record<T>(
  write: (value: T) => Promise<unknown>,
  before: T,
  after: T,
  {
    undoable,
    ...action
  }: Omit<HistoryAction, "undo" | "redo"> & {
    undoable: boolean;
  },
) {
  // the mutation's onError already rolls back and toasts
  void write(after).catch(() => {});
  if (!undoable) return;
  void pushHistory({
    ...action,
    undo: () => write(before),
    redo: () => write(after),
  });
}
