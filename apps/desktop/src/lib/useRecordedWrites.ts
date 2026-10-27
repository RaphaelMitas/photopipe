import { useQueryClient } from "@tanstack/react-query";
import {
  ClipboardPaste,
  Flag as FlagIcon,
  FlagOff,
  type LucideIcon,
  Star,
  X,
} from "lucide-react";
import { useCallback, useMemo } from "react";
import { type Edit, editKey, type Flag, type ImageFile } from "./core";
import { describeEdit } from "./describeEdit";
import { historyChannel } from "./history";
import {
  type BatchResult,
  cachedImage,
  currentEdits,
  usePasteEdits,
  useSetEdit,
  useSetFlag,
  useSetFlags,
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

export const ratingDetail = (rating: number) =>
  rating === 0 ? "cleared" : "★".repeat(rating);

type Judgment<V> = {
  of: (image: ImageFile) => V;
  describe: (value: V) => { icon: LucideIcon; label: string; detail: string };
};

const RATING: Judgment<number> = {
  of: (image) => image.rating,
  describe: (rating) => ({
    icon: Star,
    label: "Rating",
    detail: ratingDetail(rating),
  }),
};

const FLAG: Judgment<Flag> = {
  of: (image) => image.flag,
  describe: (flag) =>
    flag === 1
      ? { icon: FlagIcon, label: "Flag", detail: "picked" }
      : flag === -1
        ? { icon: X, label: "Flag", detail: "rejected" }
        : { icon: FlagOff, label: "Flag", detail: "cleared" },
};

/// `one` and `many` stay stable across renders, so an entry can hold on to them.
function useRecordedJudgment<V>(
  shoot: string | null,
  judgment: Judgment<V>,
  setOne: (vars: { path: string; value: V }) => Promise<unknown>,
  setMany: (values: Map<string, V>) => Promise<BatchResult>,
) {
  const queryClient = useQueryClient();
  const channel = useMemo(
    () => historyChannel((values: Map<string, V>) => landed(setMany(values))),
    [setMany],
  );

  const one = useCallback(
    (path: string, value: V) => {
      const image = cachedImage(queryClient, shoot, path);
      if (!image || judgment.of(image) === value) return;
      const written = setOne({ path, value });
      // the mutation already rolled back and toasted; the channel drops the entry
      void written.catch(() => {});
      // before the core has read the file, the old value is a placeholder
      if (!image.enriched) return;
      void channel.record(
        { ...judgment.describe(value), paths: [path], written },
        new Map([[path, judgment.of(image)]]),
        new Map([[path, value]]),
      );
    },
    [queryClient, shoot, judgment, setOne, channel],
  );

  /// `before` has to be read, not placeholder, values: undo writes them back.
  const many = useCallback(
    (values: Map<string, V>, before: Map<string, V>, detail?: string) => {
      const [first] = values.values();
      if (first === undefined) return Promise.resolve();
      const written = landed(setMany(values));
      void written.catch(() => {});
      const described = judgment.describe(first);
      void channel.record(
        {
          ...described,
          detail: detail ?? described.detail,
          paths: [...values.keys()],
          written,
        },
        before,
        values,
      );
      return written;
    },
    [judgment, setMany, channel],
  );

  return { one, many };
}

export function useRecordedWrites(shoot: string | null) {
  const queryClient = useQueryClient();
  const setEdit = useSetEdit(shoot);
  const pasteEdits = usePasteEdits(shoot);
  const ratings = useRecordedJudgment(
    shoot,
    RATING,
    useSetRating(shoot),
    useSetRatings(shoot),
  );
  const flags = useRecordedJudgment(
    shoot,
    FLAG,
    useSetFlag(shoot),
    useSetFlags(shoot),
  );

  const edits = useMemo(
    () =>
      historyChannel((values: Map<string, Edit>) => landed(pasteEdits(values))),
    [pasteEdits],
  );

  const writeEdit = useCallback(
    (path: string, edit: Edit) => {
      const image = cachedImage(queryClient, shoot, path);
      if (!image || editKey(image.edit) === editKey(edit)) return;
      const written = setEdit({ path, value: edit });
      void written.catch(() => {});
      void edits.record(
        {
          ...describeEdit(image.edit, edit, image.isRaw),
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
    (pasted: Map<string, Edit>): Promise<BatchResult> => {
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

  return {
    rate: ratings.one,
    rateMany: ratings.many,
    flag: flags.one,
    flagMany: flags.many,
    writeEdit,
    paste,
  };
}
