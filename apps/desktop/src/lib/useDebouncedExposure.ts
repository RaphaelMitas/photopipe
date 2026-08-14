import { useCallback, useEffect, useRef, useState } from "react";

export type ExposureDraft = { path: string; value: number } | null;

export function useDebouncedExposure(
  commit: (path: string, value: number) => void,
  delayMs: number,
) {
  const [draft, setDraft] = useState<ExposureDraft>(null);
  const timer = useRef<number | null>(null);
  const pending = useRef<ExposureDraft>(null);
  // `commit` closes over a react-query mutation and so changes identity every
  // render; read it through a ref so `flush` can stay referentially stable —
  // otherwise the unmount effect below would re-run its cleanup every render
  // and collapse the debounce into a write per tick.
  const commitRef = useRef(commit);
  commitRef.current = commit;

  const flush = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const next = pending.current;
    if (!next) return;
    pending.current = null;
    setDraft(null);
    commitRef.current(next.path, next.value);
  }, []);

  const scrub = useCallback(
    (path: string, value: number) => {
      if (pending.current && pending.current.path !== path) flush();
      setDraft({ path, value });
      pending.current = { path, value };
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, delayMs);
    },
    [flush, delayMs],
  );

  useEffect(() => () => flush(), [flush]);

  return { draft, scrub, flush };
}
