import { useCallback, useEffect, useRef, useState } from "react";
import type { Edit } from "./core";

// a context menu or a lost window can swallow the pointerup
const RELEASES = ["pointerup", "pointercancel", "contextmenu", "blur"];

type EditDraft = { path: string; edit: Edit } | null;

export function useDebouncedEdit(
  commit: (path: string, edit: Edit) => Promise<unknown> | undefined,
  delayMs: number,
) {
  const [draft, setDraft] = useState<EditDraft>(null);
  const timer = useRef<number | null>(null);
  const pending = useRef<EditDraft>(null);
  // A caller may pass a fresh closure every render; through a ref `flush` stays
  // stable and the unmount effect below does not turn into a write per tick.
  const commitRef = useRef(commit);
  commitRef.current = commit;

  const takePending = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const taken = pending.current;
    pending.current = null;
    return taken;
  }, []);

  // Pasting over the photo being scrubbed cancels rather than flushes: the
  // pending value would land after the paste.
  const cancel = useCallback(() => {
    takePending();
    setDraft(null);
  }, [takePending]);

  const flush = useCallback(() => {
    const next = takePending();
    if (!next) return;
    // The optimistic patch lands async, so the draft stays until the write settles.
    const settled = () => setDraft((draft) => (draft === next ? null : draft));
    Promise.resolve(commitRef.current(next.path, next.edit)).then(
      settled,
      settled,
    );
  }, [takePending]);

  // A drag saves once, on release; everything else saves at rest.
  const held = useRef(false);
  const hold = useCallback(() => {
    held.current = true;
    const release = () => {
      held.current = false;
      flush();
      for (const type of RELEASES) window.removeEventListener(type, release);
    };
    // on window: a pointer that went down in the panel can come up anywhere
    for (const type of RELEASES) window.addEventListener(type, release);
  }, [flush]);

  const scrub = useCallback(
    (path: string, edit: Edit) => {
      if (pending.current && pending.current.path !== path) flush();
      const next = { path, edit };
      setDraft(next);
      pending.current = next;
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = held.current ? null : window.setTimeout(flush, delayMs);
    },
    [flush, delayMs],
  );

  useEffect(() => () => flush(), [flush]);

  return { draft, scrub, flush, cancel, hold };
}
