import "@testing-library/jest-dom/vitest";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??=
  ResizeObserverStub as unknown as typeof ResizeObserver;

// Radix Select needs these in jsdom.
window.HTMLElement.prototype.hasPointerCapture ??= () => false;
window.HTMLElement.prototype.releasePointerCapture ??= () => {};
window.HTMLElement.prototype.scrollIntoView ??= () => {};

// Menu events reach the app through Tauri's event bridge, which only exists in
// a real window. Without this, listen() throws on mount.
let nextEventCallback = 1;
(
  window as unknown as { __TAURI_INTERNALS__?: Record<string, unknown> }
).__TAURI_INTERNALS__ ??= {
  transformCallback: () => nextEventCallback++,
  invoke: () => Promise.resolve(0),
};

globalThis.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof matchMedia;
