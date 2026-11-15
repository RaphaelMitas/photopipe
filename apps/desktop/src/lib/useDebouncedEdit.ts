import { useCallback, useEffect, useRef, useState } from "react";
import type { Edit } from "./core";

const RELEASES = ["pointerup", "pointercancel", "contextmenu", "blur"];

type EditDraft = { path: string; edit: Edit } | null;

export function useDebouncedEdit(
  commit: (path: string, edit: Edit) => Promise<unknown> | undefined,
  delayMs: number,
) {
  const [draft, setDraft] = useState<EditDraft>(null);
  const timer = useRef<number | null>(null);
  const pending = useRef<EditDraft>(null);
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

  const cancel = useCallback(() => {
    takePending();
    setDraft(null);
  }, [takePending]);

  const flush = useCallback(() => {
    const next = takePending();
    if (!next) return Promise.resolve();
    const settled = () => setDraft((draft) => (draft === next ? null : draft));
    const written = Promise.resolve(commitRef.current(next.path, next.edit));
    written.then(settled, settled);
    return written;
  }, [takePending]);

  const held = useRef(false);
  const hold = useCallback(() => {
    held.current = true;
    const release = () => {
      held.current = false;
      flush();
      for (const type of RELEASES) window.removeEventListener(type, release);
    };
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

  useEffect(
    () => () => {
      void flush();
    },
    [flush],
  );

  const busy = useCallback(() => held.current || pending.current !== null, []);

  return { draft, scrub, flush, cancel, hold, busy };
}
