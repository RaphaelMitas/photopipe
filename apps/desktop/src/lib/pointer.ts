export function cursorIn(
  node: HTMLElement,
  event: { clientX: number; clientY: number },
) {
  const bounds = node.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

// Synthetic and already-released pointers make setPointerCapture throw.
export function capturePointer(event: {
  currentTarget: Element;
  pointerId: number;
}) {
  try {
    event.currentTarget.setPointerCapture(event.pointerId);
  } catch {}
}
