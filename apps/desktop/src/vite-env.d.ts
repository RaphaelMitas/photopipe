/// <reference types="vite/client" />

// WebKit's trackpad pinch events, which lib.dom leaves out.
interface GestureEvent extends UIEvent {
  readonly scale: number;
  readonly rotation: number;
  readonly clientX: number;
  readonly clientY: number;
}

interface HTMLElementEventMap {
  gesturestart: GestureEvent;
  gesturechange: GestureEvent;
  gestureend: GestureEvent;
}
