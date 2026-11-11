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
import { useMaskSupport } from "./queries";
import type { MaskSession } from "./useMaskSession";

type Ask = CoreMethods["maskAt"]["params"];
type Wanted = { ask: Ask; scene: string };
type Cursor = {
  clientX: number;
  clientY: number;
  shiftKey: boolean;
  altKey: boolean;
};

// a press that travels further is a pan
const CLICK_SLOP = 4;
// sent inline with every hover answer, so a quarter the pixels of the kept overlay
const PREVIEW_MAX_PIXEL = 1024;

/// A plain click masks while the field is open; Shift and Option grow or cut the selected click mask.
export function useMaskPick(
  image: ImageFile | undefined,
  edit: Edit,
  masks: MaskSession,
  /// In fractions of the photo as shown, null off the photo or where it takes no clicks.
  spotAt: (cursor: Cursor) => { x: number; y: number } | null,
) {
  const frame = unedited(edit);
  // an answer is shown only while a click would still do what was asked
  const scene = `${image?.path}|${editKey(frame)}|${masks.creating}|${masks.target?.id}`;
  const clickLimit = useMaskSupport().data?.clicks ?? 0;
  const clicks = edit.masks.reduce((sum, mask) => sum + mask.points.length, 0);
  const [answer, setAnswer] = useState<{ scene: string; png: string } | null>(
    null,
  );
  const [picking, setPicking] = useState(false);
  const hover = useRef<{ wanted: Wanted | null; asking: boolean }>({
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
    return { ask, refined, scene };
  };

  // one question at a time, and only the newest of those that waited
  const show = async (wanted: Wanted | null) => {
    const state = hover.current;
    state.wanted = wanted;
    if (!wanted) setAnswer(null);
    if (state.asking) return;
    state.asking = true;
    for (
      let next = state.wanted;
      next;
      next = state.wanted === next ? null : state.wanted
    ) {
      const png = await coreRequest("maskAt", next.ask).then(
        (pick) => pick.png,
        () => null,
      );
      if (state.wanted && png) setAnswer({ scene: next.scene, png });
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
    if (clicks >= clickLimit) {
      toast("This photo cannot take more clicks", { id: "mask-clicks" });
      return;
    }
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
        show(hovering ? askAt(event) : null);
      },
      onPointerLeave: () => {
        show(null);
      },
    },
  };
}
