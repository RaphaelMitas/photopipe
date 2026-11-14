import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Bot } from "lucide-react";
import { useEffect, useRef } from "react";
import {
  type CropRect,
  type Edit,
  editKey,
  type Flag,
  type ImageFile,
  identityEdit,
  type Shoot,
} from "./core";
import {
  commitDraft,
  draftFromEdit,
  draftWithAngle,
  rotatedSize,
  STRAIGHTEN_SLIDER_RANGE,
  turnCrop,
} from "./crop";
import {
  COLOR_SLIDERS,
  DENOISE_RANGE,
  EXPOSURE_RANGE,
  PRESENCE_SLIDERS,
  SIGNED_RANGE,
  storedBalance,
  TONE_SLIDERS,
  temperatureRange,
  tintRange,
} from "./editSliders";
import {
  type HistoryDirection,
  type HistoryEntry,
  historyLabel,
  historyState,
} from "./history";
import { type Context, isActionId } from "./keymap";
import { isModalOpen } from "./modal";
import type { BatchResult } from "./queries";
import { activeContext, availableActions, runAction } from "./shortcuts";
import { flaggedTo, ratedTo } from "./stacks";

export type AgentView = {
  shoots: Shoot[] | undefined;
  shoot: string | null;
  images: ImageFile[] | undefined;
  visible: ImageFile[];
  loupe: ImageFile | null;
  selected: ImageFile[];
  filter: { stars: ReadonlySet<number>; flags: ReadonlySet<Flag> };
  sort: string;
  live: (path: string) => ImageFile | undefined;
  editOf: (image: ImageFile) => Edit;
  enter: (shoot: string) => void;
  open: (path: string) => void;
  close: () => void;
  select: (paths: string[]) => void;
  resetFilter: () => void;
  rate: (values: Map<string, number>, before: ImageFile[]) => Promise<unknown>;
  flag: (values: Map<string, Flag>, before: ImageFile[]) => Promise<unknown>;
  edit: (edits: Map<string, Edit>) => Promise<BatchResult>;
  step: (direction: HistoryDirection) => Promise<HistoryEntry | null>;
  exportPhotos: (
    paths: string[],
    request: AgentExport,
  ) => Promise<{ id: string } | null>;
  trash: (paths: string[]) => Promise<number>;
  trashBlocked: boolean;
  editing: boolean;
};

export type AgentExport = {
  destination: string;
  format: "original" | "jpeg";
  quality?: number;
  longEdge?: number;
  zip: boolean;
};

type FlagName = "picked" | "rejected" | "unflagged";

/// The host checked these against its own argument types before sending them.
type AgentCall =
  | { tool: "get_view"; args: Record<string, never> }
  | {
      tool: "show";
      args: {
        shoot: string | null;
        photo: string | null;
        select: string[] | null;
      };
    }
  | { tool: "rate"; args: { photos: string[]; rating: number } }
  | { tool: "flag"; args: { photos: string[]; flag: FlagName } }
  | {
      tool: "edit";
      args: { photos: string[]; set: Partial<Edit>; reset: boolean };
    }
  | { tool: "undo"; args: { steps: number; redo: boolean } }
  | { tool: "ui_action"; args: { action: string } }
  | { tool: "export"; args: AgentExport & { photos: string[] } }
  | { tool: "trash"; args: { photos: string[] } };

/// `deadline` is a little before the host stops waiting; a call still queued then is dropped, not run late.
type Request = AgentCall & { id: number; deadline: number };

const FLAGS: Record<FlagName, Flag> = { picked: 1, rejected: -1, unflagged: 0 };
const FLAG_NAMES = ["rejected", "unflagged", "picked"];
export const AGENT_EDIT = { icon: Bot, label: "Agent edit" };

const idOf = (shoot: string, image: ImageFile) => `${shoot}/${image.rel}`;

function photosIn(view: AgentView, ids: string[]): ImageFile[] {
  const shoot = view.shoot;
  if (shoot === null || view.images === undefined) {
    throw new Error("No shoot is open. Open one with show first.");
  }
  const byRel = new Map(view.images.map((image) => [image.rel, image]));
  return ids.map((id) => {
    const slash = id.indexOf("/");
    if (id.slice(0, slash) !== shoot) {
      throw new Error(
        `${id} is not in the open shoot ${shoot}. Open its shoot with show first.`,
      );
    }
    const image = byRel.get(id.slice(slash + 1));
    if (!image) throw new Error(`No photo ${id} in ${shoot}.`);
    return view.live(image.path) ?? image;
  });
}

/// Moving the view under a drag would carry the drag onto another photo, and leaving the loupe drops a crop.
function busy(view: AgentView) {
  if (view.editing) {
    throw new Error(
      "The user is editing a photo right now. Try again in a moment.",
    );
  }
}

function settled(photos: ImageFile[]) {
  if (photos.some((photo) => !photo.enriched)) {
    throw new Error(
      "Photopipe is still reading these photos' ratings and edits. Try again in a moment.",
    );
  }
  return photos;
}

const clamp = (value: number, { min, max }: { min: number; max: number }) =>
  Math.min(Math.max(value, min), max);

const SLIDERS = [...TONE_SLIDERS, ...PRESENCE_SLIDERS, ...COLOR_SLIDERS].map(
  (slider) => slider.key,
);

/// Held to the editor's own ranges, and framed the way the crop tool frames.
export function agentEdit(
  base: Edit,
  set: Partial<Edit>,
  photo: ImageFile,
): Edit {
  const next: Edit = { ...base };
  for (const key of SLIDERS) {
    const value = set[key];
    if (value !== undefined) next[key] = clamp(value, SIGNED_RANGE);
  }
  if (set.exposure !== undefined) {
    next.exposure = clamp(set.exposure, {
      min: -EXPOSURE_RANGE,
      max: EXPOSURE_RANGE,
    });
  }
  if (typeof set.temperature === "number") {
    next.temperature = storedBalance(
      photo.isRaw,
      clamp(set.temperature, temperatureRange(photo.isRaw)),
    );
  }
  if (typeof set.tint === "number") {
    next.tint = storedBalance(
      photo.isRaw,
      clamp(set.tint, tintRange(photo.isRaw)),
    );
  }
  if (typeof set.denoise === "number") {
    next.denoise = clamp(set.denoise, DENOISE_RANGE);
  }
  if (
    set.crop === undefined &&
    set.cropAngle === undefined &&
    set.rotation === undefined
  ) {
    return next;
  }
  const before = base.rotation ?? 0;
  const rotation = set.rotation ?? before;
  if (![0, 90, 180, 270].includes(rotation)) {
    throw new Error("rotation is 0, 90, 180 or 270");
  }
  // the crop lives in the turned frame, so a turn carries it round like the crop tool's Turn
  let crop = set.crop ? checkedCrop(set.crop) : (base.crop ?? null);
  for (
    let turn = before;
    !set.crop && crop && turn !== rotation;
    turn = (turn + 90) % 360
  ) {
    crop = turnCrop(crop);
  }
  const draft = draftFromEdit(
    { crop, cropAngle: base.cropAngle, rotation },
    photo.width,
    photo.height,
  );
  const [width, height] = rotatedSize(photo.width, photo.height, rotation);
  const angle =
    set.cropAngle === undefined
      ? draft.angle
      : clamp(set.cropAngle, {
          min: -STRAIGHTEN_SLIDER_RANGE,
          max: STRAIGHTEN_SLIDER_RANGE,
        });
  return {
    ...next,
    ...commitDraft(draftWithAngle(draft, angle, width, height)),
  };
}

function checkedCrop(crop: CropRect): CropRect {
  const { left, top, right, bottom } = crop;
  if (
    [left, top, right, bottom].some((value) => value < 0 || value > 1) ||
    right <= left ||
    bottom <= top
  ) {
    throw new Error(
      "crop is left < right and top < bottom, each between 0 and 1",
    );
  }
  return crop;
}

function viewOf(view: AgentView) {
  const shoot = view.shoot;
  const { entries, cursor } = historyState();
  const context: Context = activeContext();
  return {
    shoot,
    mode: context,
    photo: shoot && view.loupe ? idOf(shoot, view.loupe) : null,
    selection: {
      count: view.selected.length,
      photos: shoot
        ? view.selected.slice(0, 100).map((image) => idOf(shoot, image))
        : [],
    },
    filter: {
      stars: [...view.filter.stars].sort(),
      flags: [...view.filter.flags].map((flag) => FLAG_NAMES[flag + 1]),
    },
    sort: view.sort,
    history: entries
      .map((entry, index) => ({
        step: historyLabel(entry),
        undone: index >= cursor,
      }))
      .slice(-10),
    actions: availableActions(),
  };
}

/// Answers the host's `agent:request` events through the same paths the user's keys and clicks take.
export function useAgentTools(enabled: boolean, view: AgentView) {
  const current = useRef(view);
  current.current = view;
  const waiting = useRef<(() => void)[]>([]);
  useEffect(() => {
    const woken = waiting.current;
    waiting.current = [];
    for (const wake of woken) wake();
  });

  useEffect(() => {
    if (!enabled) return;
    const rendered = () =>
      new Promise<void>((resolve) => {
        waiting.current.push(resolve);
        setTimeout(resolve, 100);
      });
    const until = async (done: () => boolean, what: string) => {
      const deadline = Date.now() + 15_000;
      while (!done()) {
        if (Date.now() > deadline) throw new Error(`Timed out ${what}.`);
        await rendered();
      }
    };

    const handle = async (call: AgentCall) => {
      const view = current.current;
      switch (call.tool) {
        case "get_view":
          return viewOf(view);
        case "show": {
          busy(view);
          const { shoot, photo, select } = call.args;
          if (shoot !== null && shoot !== view.shoot) {
            if (!view.shoots?.some((known) => known.name === shoot)) {
              throw new Error(`No shoot named ${shoot}.`);
            }
            view.enter(shoot);
            await until(
              () =>
                current.current.shoot === shoot &&
                current.current.images !== undefined,
              `opening ${shoot}`,
            );
          }
          const target =
            photo === null ? null : photosIn(current.current, [photo])[0];
          const chosen =
            select === null ? null : photosIn(current.current, select);
          const shown = [...(target ? [target] : []), ...(chosen ?? [])];
          const visible = new Set(
            current.current.visible.map((image) => image.path),
          );
          if (shown.some((image) => !visible.has(image.path))) {
            current.current.resetFilter();
            await rendered();
          }
          if (chosen !== null) {
            current.current.close();
            current.current.select(chosen.map((image) => image.path));
          }
          if (target !== null) {
            current.current.open(target.path);
            await until(
              () => current.current.loupe?.path === target.path,
              `opening ${photo}`,
            );
          }
          await rendered();
          return viewOf(current.current);
        }
        case "rate": {
          const photos = settled(photosIn(view, call.args.photos));
          const changes = ratedTo(photos, call.args.rating);
          if (changes.size > 0) await view.rate(changes, photos);
          return { changed: changes.size };
        }
        case "flag": {
          const photos = settled(photosIn(view, call.args.photos));
          const changes = flaggedTo(photos, FLAGS[call.args.flag]);
          if (changes.size > 0) await view.flag(changes, photos);
          return { changed: changes.size };
        }
        case "edit": {
          const photos = settled(photosIn(view, call.args.photos));
          const { temperature, tint } = call.args.set;
          const raws = new Set(photos.map((photo) => photo.isRaw));
          if ((temperature != null || tint != null) && raws.size > 1) {
            throw new Error(
              "temperature and tint are kelvin on raws and an offset on other files; edit the two in separate calls.",
            );
          }
          const edits = new Map<string, Edit>();
          for (const photo of photos) {
            const now = view.editOf(photo);
            const next = agentEdit(
              call.args.reset ? identityEdit : now,
              call.args.set,
              photo,
            );
            if (editKey(next) !== editKey(now)) edits.set(photo.path, next);
          }
          if (edits.size === 0) return { changed: 0 };
          const result = await view.edit(edits);
          return { changed: result.written, editedSince: result.overtaken };
        }
        case "undo": {
          const direction = call.args.redo ? "redo" : "undo";
          const steps: string[] = [];
          for (let step = 0; step < call.args.steps; step++) {
            const entry = await view.step(direction);
            if (!entry) break;
            steps.push(historyLabel(entry));
          }
          return { [direction === "undo" ? "undid" : "redid"]: steps };
        }
        case "ui_action": {
          const { action } = call.args;
          if (!isActionId(action)) throw new Error(`No action ${action}.`);
          busy(view);
          if (isModalOpen()) {
            throw new Error(
              "A dialog is open in Photopipe; ask the user to close it.",
            );
          }
          if (!runAction(action)) {
            const here = availableActions().map((known) => known.id);
            throw new Error(
              `${action} does nothing in the ${activeContext()} view. These work here: ${here.join(", ")}.`,
            );
          }
          await rendered();
          return viewOf(current.current);
        }
        case "export": {
          const { photos, ...request } = call.args;
          const paths = photosIn(view, photos).map((photo) => photo.path);
          const job = await view.exportPhotos(paths, request);
          if (!job) throw new Error("The export did not start.");
          return { id: job.id };
        }
        case "trash": {
          const paths = photosIn(view, call.args.photos).map(
            (photo) => photo.path,
          );
          await until(
            () => !current.current.trashBlocked,
            "waiting for pending writes",
          );
          return { files: await current.current.trash(paths) };
        }
      }
    };

    // one at a time, so a second call reads what the first one wrote
    let queue: Promise<unknown> = Promise.resolve();
    const subscription = listen<Request>("agent:request", ({ payload }) => {
      const { id, deadline } = payload;
      const answer = (ok: boolean, value: unknown) =>
        invoke("agent_reply", { id, ok, value }).catch(() => {});
      let started = false;
      let dropped = false;
      const drop = setTimeout(() => {
        if (started) return;
        dropped = true;
        void answer(false, "Photopipe was busy; this call was dropped.");
      }, deadline - Date.now());
      const run = queue.then(async () => {
        // a throttled timer can fire after its turn comes; it still answers the call as dropped
        if (dropped || Date.now() > deadline) return;
        started = true;
        clearTimeout(drop);
        try {
          await answer(true, await handle(payload));
        } catch (error) {
          await answer(
            false,
            error instanceof Error ? error.message : String(error),
          );
        }
      });
      queue = run;
    });
    let gone = false;
    subscription
      .then(() => gone || invoke("agent_attach", { attached: true }))
      .catch(() => {});
    return () => {
      gone = true;
      void invoke("agent_attach", { attached: false }).catch(() => {});
      void subscription.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [enabled]);
}
