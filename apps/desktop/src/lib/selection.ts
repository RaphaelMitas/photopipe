import { useCallback, useMemo, useRef, useState } from "react";

export function useSelection(ordered: string[]) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const anchor = useRef<string | null>(null);

  const pruned = useMemo(() => {
    const present = new Set(ordered);
    let changed = false;
    const next = new Set<string>();
    for (const path of selected) {
      if (present.has(path)) next.add(path);
      else changed = true;
    }
    return changed ? next : selected;
  }, [ordered, selected]);

  const click = useCallback(
    (path: string, modifiers: { meta?: boolean; shift?: boolean }) => {
      setSelected((current) => {
        if (modifiers.shift && anchor.current) {
          const from = ordered.indexOf(anchor.current);
          const to = ordered.indexOf(path);
          if (from !== -1 && to !== -1) {
            const [start, end] = from < to ? [from, to] : [to, from];
            const next = new Set(modifiers.meta ? current : []);
            for (const inRange of ordered.slice(start, end + 1))
              next.add(inRange);
            return next;
          }
        }
        anchor.current = path;
        if (modifiers.meta) {
          const next = new Set(current);
          if (next.has(path)) next.delete(path);
          else next.add(path);
          return next;
        }
        if (current.size === 1 && current.has(path)) return new Set();
        return new Set([path]);
      });
    },
    [ordered],
  );

  const selectAll = useCallback(() => {
    anchor.current = ordered[0] ?? null;
    setSelected(new Set(ordered));
  }, [ordered]);

  const select = useCallback((paths: string[]) => {
    anchor.current = paths[0] ?? null;
    setSelected(new Set(paths));
  }, []);

  const clear = useCallback(() => {
    anchor.current = null;
    setSelected(new Set());
  }, []);

  return {
    selected: pruned,
    click,
    selectAll,
    select,
    clear,
    isEmpty: pruned.size === 0,
  };
}
