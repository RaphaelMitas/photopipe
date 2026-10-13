import type { Rect } from "@tanstack/react-virtual";

// jsdom has no layout, so tests hand the virtualizer a viewport that never changes.
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
