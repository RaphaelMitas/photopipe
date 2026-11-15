import type { Virtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef } from "react";

export function useVirtualJump(
  virtualizer: Virtualizer<HTMLDivElement, Element>,
  index: number,
  ready = true,
  revealed = 0,
) {
  const jumped = useRef(false);
  useEffect(() => {
    if (jumped.current || !ready) return;
    if (index === -1) {
      jumped.current = true;
      return;
    }
    const frame = requestAnimationFrame(() => {
      jumped.current = true;
      virtualizer.scrollToIndex(index, { align: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [index, ready]);

  useEffect(() => {
    if (revealed > 0 && index !== -1) {
      virtualizer.scrollToIndex(index, { align: "auto" });
    }
  }, [revealed]);
}
