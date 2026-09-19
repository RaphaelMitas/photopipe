import { useCallback, useEffect, useRef, useState } from "react";
import type { Edit } from "./core";

export type EditDraft = { path: string; edit: Edit } | null;

export function useDebouncedEdit(
  commit: (path: string, edit: Edit) => void,
  delayMs: number,
) {
  const [draft, setDraft] = useState<EditDraft>(null);
  const timer = useRef<number | null>(null);
  const pending = useRef<EditDraft>(null);
  // A caller may pass a fresh closure every render; through a ref `flush` stays
  // stable and the unmount effect below does not turn into a write per tick.
  const commitRef = useRef(commit);
  commitRef.current = commit;

  // Pasting over the photo being scrubbed cancels rather than flushes: the
  // pending value would land after the paste.
  const cancel = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    pending.current = null;
    setDraft(null);
  }, []);

  const flush = useCallback(() => {
    const next = pending.current;
    cancel();
    if (next) commitRef.current(next.path, next.edit);
  }, [cancel]);

  // A drag saves once, on release; everything else saves at rest.
  const held = useRef(false);
  const hold = useCallback(() => {
    held.current = true;
  }, []);
  const release = useCallback(() => {
    held.current = false;
    flush();
  }, [flush]);

  const scrub = useCallback(
    (path: string, edit: Edit) => {
      if (pending.current && pending.current.path !== path) flush();
      setDraft({ path, edit });
      pending.current = { path, edit };
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = held.current ? null : window.setTimeout(flush, delayMs);
    },
    [flush, delayMs],
  );

  useEffect(() => () => flush(), [flush]);

  return { draft, scrub, flush, cancel, hold, release };
}
