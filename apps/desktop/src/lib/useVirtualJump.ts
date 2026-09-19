import type { Virtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef } from "react";

export function useVirtualJump(
  virtualizer: Virtualizer<HTMLDivElement, Element>,
  index: number,
  ready = true,
  revealed = 0,
) {
  const jumped = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the mount jumps
  useEffect(() => {
    if (jumped.current || !ready) return;
    // a match arriving later must not yank the scroll out from under the user
    if (index === -1) {
      jumped.current = true;
      return;
    }
    // the virtualizer re-applies its own offset on attach, undoing a jump here
    const frame = requestAnimationFrame(() => {
      jumped.current = true;
      virtualizer.scrollToIndex(index, { align: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [index, ready]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a reveal is the trigger, the index only says where
  useEffect(() => {
    if (revealed > 0 && index !== -1) {
      virtualizer.scrollToIndex(index, { align: "auto" });
    }
  }, [revealed]);
}
