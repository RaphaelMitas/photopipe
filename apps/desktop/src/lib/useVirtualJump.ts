import type { Virtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef } from "react";

/// Centres a virtualized list on one item, once, when it mounts — how the
/// browser lands back on the photo the loupe was showing. Pass ready=false
/// while the sizes it would scroll against are still a guess.
export function useVirtualJump(
  virtualizer: Virtualizer<HTMLDivElement, Element>,
  index: number,
  ready = true,
) {
  const jumped = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the jump belongs to the mount, not to every render
  useEffect(() => {
    if (jumped.current || !ready || index === -1) return;
    // Attaching to the scroll element re-applies the virtualizer's own offset,
    // which undoes a jump made in this effect. The next frame is past that.
    const frame = requestAnimationFrame(() => {
      jumped.current = true;
      virtualizer.scrollToIndex(index, { align: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [index, ready]);
}
