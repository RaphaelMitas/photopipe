import "@testing-library/jest-dom/vitest";

// jsdom has no ResizeObserver; the grid only needs it to exist.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??=
  ResizeObserverStub as unknown as typeof ResizeObserver;
