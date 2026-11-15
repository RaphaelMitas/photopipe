const OPEN_MODAL =
  "[data-slot='dialog-content'][data-state='open'], [data-slot='sheet-content'][data-state='open']";

export function isModalOpen(): boolean {
  return document.querySelector(OPEN_MODAL) !== null;
}
