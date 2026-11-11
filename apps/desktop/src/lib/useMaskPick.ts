import {
  type MouseEvent,
  type PointerEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  type CoreMethods,
  coreRequest,
  type Edit,
  editKey,
  type ImageFile,
  shapeKey,
  unedited,
} from "./core";
import { useMaskClickLimit } from "./queries";
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

export function useMaskPick(
  image: ImageFile | undefined,
  edit: Edit,
  masks: MaskSession,
  framedFractionAt: (cursor: Cursor) => { x: number; y: number } | null,
) {
  const frame = unedited(edit);
  const target = masks.target;
  // a preview or a click lands only on the photo, frame and mask it was asked about
  const scene = `${image?.path}|${editKey(frame)}|${masks.creating}|${target?.id}|${target && shapeKey(target)}`;
  const clickLimit = useMaskClickLimit();
  const [answer, setAnswer] = useState<{ scene: string; png: string } | null>(
    null,
  );
  const [picking, setPicking] = useState(false);
  const hover = useRef<{ wanted: Wanted | null; asking: boolean }>({
    wanted: null,
    asking: false,
  });
  const pressed = useRef<{ x: number; y: number } | null>(null);
  // an answer lands a render or a model load later, when the loupe may be gone
  const live = useRef<{ masks: MaskSession; scene: string } | null>(null);
  useLayoutEffect(() => {
    live.current = { masks, scene };
    return () => {
      live.current = null;
    };
  });

  const askAt = (cursor: Cursor) => {
    const modified = cursor.shiftKey || cursor.altKey;
    const refined = modified && target?.source === "click" ? target : null;
    if (!image || !clickLimit || (modified ? !refined : !masks.creating))
      return null;
    const spot = framedFractionAt(cursor);
    if (!spot) return null;
    const ask: Ask = {
      path: image.path,
      edit: frame,
      points: refined?.points ?? [],
      inverted: refined?.inverted ?? false,
      ...spot,
      // on an inverted mask, adding to what is shown cuts it from what the model found
      include: cursor.altKey === (refined?.inverted ?? false),
      maxPixel: PREVIEW_MAX_PIXEL,
    };
    const full = (refined?.points.length ?? 0) >= clickLimit;
    return { ask, refined, scene, full };
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
    if (asked.full) {
      toast("This mask cannot take more clicks", { id: "mask-clicks" });
      return;
    }
    setPicking(true);
    try {
      const { point } = await coreRequest("maskAt", asked.ask);
      const now = live.current;
      if (now?.scene !== scene) return;
      if (asked.refined) now.masks.refine(asked.refined, point);
      else now.masks.click(point);
      // an undo restores the old scene, and its answer would come back with it
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
    crosshair: clickLimit > 0 && masks.creating,
    claims: (cursor: Cursor) => askAt(cursor) !== null,
    onClick,
    photoProps: {
      onPointerDown: (event: PointerEvent) => {
        pressed.current =
          event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
      },
      onPointerMove: (event: PointerEvent) => {
        const hovering = event.pointerType === "mouse" && event.buttons === 0;
        const asked = hovering ? askAt(event) : null;
        show(asked?.full ? null : asked);
      },
      onPointerLeave: () => {
        show(null);
      },
    },
  };
}
