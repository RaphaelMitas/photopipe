import { type MouseEvent, type PointerEvent, useRef, useState } from "react";
import { toast } from "sonner";
import {
  type CoreMethods,
  coreRequest,
  type Edit,
  editKey,
  type ImageFile,
  unedited,
} from "./core";
import type { MaskSession } from "./useMaskSession";

type Ask = CoreMethods["maskAt"]["params"];
type Cursor = {
  clientX: number;
  clientY: number;
  shiftKey: boolean;
  altKey: boolean;
};

const sceneOf = (path: string | undefined, frame: Edit) =>
  `${path}|${editKey(frame)}`;

// a press that travels further is a pan
const CLICK_SLOP = 4;
// crosses into the webview on every mouse move, a third the bytes of the kept overlay
const PREVIEW_MAX_PIXEL = 1024;

/// Clicks on the photo become masks. A plain click starts one while the field
/// is open; Shift and Option grow and cut the click mask that has the sliders.
export function useMaskPick(
  image: ImageFile | undefined,
  edit: Edit,
  masks: MaskSession,
  /// In fractions of the photo as shown, null off the photo or where it takes no clicks.
  spotAt: (cursor: Cursor) => { x: number; y: number } | null,
) {
  const frame = unedited(edit);
  const scene = sceneOf(image?.path, frame);
  const [answer, setAnswer] = useState<{ scene: string; png: string } | null>(
    null,
  );
  const [picking, setPicking] = useState(false);
  const hover = useRef<{ wanted: Ask | null; asking: boolean }>({
    wanted: null,
    asking: false,
  });
  const pressed = useRef<{ x: number; y: number } | null>(null);
  // an answer lands a render or a model load later
  const live = useRef({ masks, scene });
  live.current = { masks, scene };

  const askAt = (cursor: Cursor) => {
    const modified = cursor.shiftKey || cursor.altKey;
    const refined =
      modified && masks.target?.source === "click" ? masks.target : null;
    if (!image || (modified ? !refined : !masks.creating)) return null;
    const spot = spotAt(cursor);
    if (!spot) return null;
    const ask: Ask = {
      path: image.path,
      edit: frame,
      points: refined?.points ?? [],
      inverted: refined?.inverted ?? false,
      ...spot,
      include: !cursor.altKey,
      maxPixel: PREVIEW_MAX_PIXEL,
    };
    return { ask, refined };
  };

  // one question at a time, and only the newest of those that waited
  const show = async (wanted: Ask | null) => {
    const state = hover.current;
    state.wanted = wanted;
    if (!wanted) setAnswer(null);
    if (state.asking) return;
    state.asking = true;
    for (
      let ask = state.wanted;
      ask;
      ask = state.wanted === ask ? null : state.wanted
    ) {
      const png = await coreRequest("maskAt", ask).then(
        (pick) => pick.png,
        () => null,
      );
      if (state.wanted && png) {
        setAnswer({ scene: sceneOf(ask.path, ask.edit), png });
      }
    }
    state.asking = false;
  };

  const onClick = async (event: MouseEvent) => {
    const from = pressed.current;
    pressed.current = null;
    if (!from || event.detail > 1 || picking) return;
    const travelled = Math.hypot(
      event.clientX - from.x,
      event.clientY - from.y,
    );
    const asked = travelled <= CLICK_SLOP ? askAt(event) : null;
    if (!asked) return;
    setPicking(true);
    try {
      const { point } = await coreRequest("maskAt", asked.ask);
      const now = live.current;
      if (now.scene !== scene) return;
      if (asked.refined) now.masks.refine(asked.refined.id, point);
      else now.masks.click(point);
      // the new mask flashes in its own colour until the cursor moves on
      show(null);
    } catch (error) {
      toast.error("Could not mask that", { description: String(error) });
    } finally {
      setPicking(false);
    }
  };

  return {
    preview: answer?.scene === scene ? answer.png : null,
    busy: picking,
    claims: (cursor: Cursor) => askAt(cursor) !== null,
    onClick,
    photoProps: {
      onPointerDown: (event: PointerEvent) => {
        pressed.current =
          event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
      },
      onPointerMove: (event: PointerEvent) => {
        const hovering = event.pointerType === "mouse" && event.buttons === 0;
        show(hovering ? (askAt(event)?.ask ?? null) : null);
      },
      onPointerLeave: () => {
        show(null);
      },
    },
  };
}
