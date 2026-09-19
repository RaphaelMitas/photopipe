import { useQueryClient } from "@tanstack/react-query";
import { ClipboardPaste, Star } from "lucide-react";
import { useCallback, useRef } from "react";
import { type Edit, editKey, type ImageFile } from "./core";
import { describeEdit } from "./describeEdit";
import { pushHistory } from "./history";
import {
  currentEdits,
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

  const rate = useCallback(
    (path: string, rating: number) => {
      const before = queryClient
        .getQueryData<ImageFile[]>(["images", shoot])
        ?.find((image) => image.path === path)?.rating;
      if (before === undefined || before === rating) return;
      const write = (value: number) =>
        live.current.setRating.mutateAsync({ path, rating: value });
      void write(rating).catch(() => {});
      pushHistory({
        icon: Star,
        label: "Rating",
        detail: rating === 0 ? "cleared" : "★".repeat(rating),
        paths: [path],
        undo: () => write(before),
        redo: () => write(rating),
      });
    },
    [queryClient, shoot],
  );

  const writeEdit = useCallback(
    (path: string, edit: Edit) => {
      const before = currentEdits(queryClient, shoot, [path]).get(path);
      if (!before || editKey(before) === editKey(edit)) return;
      const write = (value: Edit) =>
        live.current.setEdit.mutateAsync({ path, edit: value });
      void write(edit).catch(() => {});
      pushHistory({
        ...describeEdit(before, edit),
        paths: [path],
        undo: () => write(before),
        redo: () => write(edit),
      });
    },
    [queryClient, shoot],
  );

  const paste = useCallback(
    async (writes: EditWrite[]): Promise<PasteResult> => {
      const paths = writes.map((write) => write.path);
      const before = currentEdits(queryClient, shoot, paths);
      const result = await live.current.pasteEdits.mutateAsync(writes);
      if (result.written === 0) return result;
      const previous = writes.flatMap(({ path }) => {
        const edit = before.get(path);
        return edit ? [{ path, edit }] : [];
      });
      pushHistory({
        icon: ClipboardPaste,
        label: "Paste settings",
        paths,
        undo: () => live.current.pasteEdits.mutateAsync(previous),
        redo: () => live.current.pasteEdits.mutateAsync(writes),
      });
      return result;
    },
    [queryClient, shoot],
  );

  return { rate, writeEdit, paste };
}
