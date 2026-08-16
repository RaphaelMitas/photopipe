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
  // Grabbing the photo takes the keyboard back: a control left focused, like
  // the ratio dropdown, would go on swallowing the arrow keys.
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
  try {
    event.currentTarget.setPointerCapture(event.pointerId);
  } catch {}
}
