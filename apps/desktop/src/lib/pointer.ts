import { type PointerEvent, useRef } from "react";

export function cursorIn(
  node: HTMLElement,
  event: { clientX: number; clientY: number },
) {
  const bounds = node.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

export function normalizedIn(
  node: Element,
  event: { clientX: number; clientY: number },
) {
  const bounds = node.getBoundingClientRect();
  return {
    x: (event.clientX - bounds.left) / bounds.width,
    y: (event.clientY - bounds.top) / bounds.height,
  };
}

export function capturePointer(event: {
  currentTarget: Element;
  pointerId: number;
}) {
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
  try {
    event.currentTarget.setPointerCapture(event.pointerId);
  } catch {}
}

export function useDrag(onMove: (event: PointerEvent) => void) {
  const dragging = useRef(false);
  return {
    onPointerDown: (event: PointerEvent) => {
      dragging.current = true;
      capturePointer(event);
      onMove(event);
    },
    onPointerMove: (event: PointerEvent) => {
      if (dragging.current) onMove(event);
    },
    onPointerUp: () => {
      dragging.current = false;
    },
  };
}
