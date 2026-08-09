import { useCallback, useMemo, useRef, useState } from "react";

/// Finder-style temporary multi-select over an ordered list of stems.
/// Deliberately not persisted: it drives whatever action you trigger next and
/// then it's gone. Ratings remain the only judgment written to the files.
export function useSelection(ordered: string[]) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  // Shift-click extends from the last plain click, like a file manager.
  const anchor = useRef<string | null>(null);

  // Drop stems that no longer exist (deleted, filtered away) so an action can
  // never operate on something the user can't see. Returns the *same* Set
  // when nothing was dropped, so recomputing on each new `ordered` array
  // costs nothing downstream.
  const pruned = useMemo(() => {
    const present = new Set(ordered);
    let changed = false;
    const next = new Set<string>();
    for (const stem of selected) {
      if (present.has(stem)) next.add(stem);
      else changed = true;
    }
    return changed ? next : selected;
  }, [ordered, selected]);

  const click = useCallback(
    (stem: string, modifiers: { meta?: boolean; shift?: boolean }) => {
      setSelected((current) => {
        if (modifiers.shift && anchor.current) {
          const from = ordered.indexOf(anchor.current);
          const to = ordered.indexOf(stem);
          if (from !== -1 && to !== -1) {
            const [start, end] = from < to ? [from, to] : [to, from];
            const next = new Set(modifiers.meta ? current : []);
            for (const inRange of ordered.slice(start, end + 1))
              next.add(inRange);
            return next;
          }
        }
        anchor.current = stem;
        if (modifiers.meta) {
          const next = new Set(current);
          if (next.has(stem)) next.delete(stem);
          else next.add(stem);
          return next;
        }
        // A plain click on the only selected item clears it, so clicking
        // around never leaves a stale one-item selection behind.
        if (current.size === 1 && current.has(stem)) return new Set();
        return new Set([stem]);
      });
    },
    [ordered],
  );

  const selectAll = useCallback(() => {
    anchor.current = ordered[0] ?? null;
    setSelected(new Set(ordered));
  }, [ordered]);

  /// Replace the selection wholesale — the next-step button uses this to
  /// preselect a page's waiting work as a starting point you can prune.
  const select = useCallback((stems: string[]) => {
    anchor.current = stems[0] ?? null;
    setSelected(new Set(stems));
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
