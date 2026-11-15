import type { Rect } from "@tanstack/react-virtual";

export function fixedRect(initialRect: Rect | undefined) {
  if (!initialRect) return {};
  return {
    initialRect,
    observeElementRect: (_instance: unknown, cb: (rect: Rect) => void) => {
      cb(initialRect);
      return () => {};
    },
  };
}
