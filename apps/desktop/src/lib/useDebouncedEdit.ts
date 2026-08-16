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
  // `commit` closes over a react-query mutation and so changes identity every
  // render; read it through a ref so `flush` can stay referentially stable —
  // otherwise the unmount effect below would re-run its cleanup every render
  // and collapse the debounce into a write per tick.
  const commitRef = useRef(commit);
  commitRef.current = commit;

  // Drops the pending edit without writing it. Pasting onto the photo being
  // scrubbed has to cancel, not flush: two writes to one file race in the
  // core's work queue and the older one can land last.
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

  const scrub = useCallback(
    (path: string, edit: Edit) => {
      if (pending.current && pending.current.path !== path) flush();
      setDraft({ path, edit });
      pending.current = { path, edit };
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, delayMs);
    },
    [flush, delayMs],
  );

  useEffect(() => () => flush(), [flush]);

  return { draft, scrub, flush, cancel };
}
