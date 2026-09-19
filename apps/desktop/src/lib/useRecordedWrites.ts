import { useQueryClient } from "@tanstack/react-query";
import { ClipboardPaste, Star } from "lucide-react";
import { useCallback, useMemo } from "react";
import { type Edit, editKey, isRawFile } from "./core";
import { describeEdit } from "./describeEdit";
import {
  type HistoryAction,
  type HistoryChannel,
  pushHistory,
} from "./history";
import {
  cachedImage,
  currentEdits,
  type EditWrite,
  type PasteResult,
  usePasteEdits,
  useSetEdit,
  useSetRating,
  useSetRatings,
} from "./queries";

type Channel<V> = HistoryChannel & { stage: (path: string, value: V) => void };

function channel<V>(
  write: (values: Map<string, V>) => Promise<PasteResult>,
): Channel<V> {
  let staged = new Map<string, V>();
  return {
    stage: (path, value) => staged.set(path, value),
    flush: async () => {
      const values = staged;
      staged = new Map();
      // The batch resolves even when every write failed; a step must not.
      // Photos it skipped for a newer hand edit are not failures.
      const result = await write(values);
      if (result.written === 0 && result.failed.length > 0) {
        throw new Error("nothing written");
      }
    },
  };
}

type Recorded = Omit<HistoryAction, "channel" | "stage">;

// `values` holds each photo's value before and after, keyed by direction
function record<V>(
  into: Channel<V>,
  values: { undo: Map<string, V>; redo: Map<string, V> },
  action: Recorded,
) {
  void pushHistory({
    ...action,
    channel: into,
    stage: (direction, path) => {
      const value = values[direction].get(path);
      if (value !== undefined) into.stage(path, value);
    },
  });
}

export function useRecordedWrites(shoot: string | null) {
  const queryClient = useQueryClient();
  // stable across renders, so an entry can hold on to them
  const { mutateAsync: setRating } = useSetRating(shoot);
  const { mutateAsync: setRatings } = useSetRatings(shoot);
  const { mutateAsync: setEdit } = useSetEdit(shoot);
  const { mutateAsync: pasteEdits } = usePasteEdits(shoot);

  const ratings = useMemo(() => channel(setRatings), [setRatings]);
  const edits = useMemo(
    () =>
      channel((values: Map<string, Edit>) =>
        pasteEdits(Array.from(values, ([path, edit]) => ({ path, edit }))),
      ),
    [pasteEdits],
  );

  const rate = useCallback(
    (path: string, rating: number) => {
      const image = cachedImage(queryClient, shoot, path);
      if (!image || image.rating === rating) return;
      const written = setRating({ path, rating });
      // the mutation already rolled back and toasted; pushHistory drops the entry
      void written.catch(() => {});
      // before the core has read the file, the old rating is a placeholder
      if (!image.enriched) return;
      record(
        ratings,
        {
          undo: new Map([[path, image.rating]]),
          redo: new Map([[path, rating]]),
        },
        {
          icon: Star,
          label: "Rating",
          detail: rating === 0 ? "cleared" : "★".repeat(rating),
          paths: [path],
          written,
        },
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
      record(
        edits,
        { undo: new Map([[path, image.edit]]), redo: new Map([[path, edit]]) },
        {
          ...describeEdit(image.edit, edit, isRawFile(image)),
          paths: [path],
          written,
        },
      );
    },
    [queryClient, shoot, setEdit, edits],
  );

  const paste = useCallback(
    (writes: EditWrite[]): Promise<PasteResult> => {
      const paths = writes.map((write) => write.path);
      const batch = pasteEdits(writes);
      // Recorded up front: ⌘Z during a long paste has to mean this paste.
      record(
        edits,
        {
          undo: currentEdits(queryClient, shoot, paths),
          redo: new Map(writes.map((write) => [write.path, write.edit])),
        },
        {
          icon: ClipboardPaste,
          label: "Paste settings",
          paths,
          written: batch.then((result) => {
            if (result.written === 0) throw new Error("nothing pasted");
          }),
        },
      );
      return batch;
    },
    [queryClient, shoot, pasteEdits, edits],
  );

  return { rate, writeEdit, paste };
}
