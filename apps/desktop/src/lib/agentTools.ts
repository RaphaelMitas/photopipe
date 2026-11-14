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

/// Everything an agent's call needs from the app, read fresh on every render.
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

type Request = AgentCall & { id: number };

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

function settled(photos: ImageFile[]) {
  if (photos.some((photo) => !photo.enriched)) {
    throw new Error(
      "Photopipe is still reading these photos' ratings and edits. Try again in a moment.",
    );
  }
  return photos;
}

const clamp = (value: number, low: number, high: number) =>
  Math.min(Math.max(value, low), high);

/// The editor's own slider ranges; temperature and tint are kelvin and wider on raws.
export function agentEdit(base: Edit, set: Partial<Edit>, raw: boolean): Edit {
  const next: Edit = { ...base };
  const sliders = [
    "highlights",
    "shadows",
    "whites",
    "blacks",
    "texture",
    "clarity",
    "dehaze",
    "vibrance",
    "saturation",
  ] as const;
  for (const key of sliders) {
    const value = set[key];
    if (typeof value === "number") next[key] = clamp(value, -100, 100);
  }
  if (typeof set.exposure === "number") {
    next.exposure = clamp(set.exposure, -3, 3);
  }
  if (typeof set.temperature === "number") {
    next.temperature = raw
      ? clamp(set.temperature, 2000, 12000)
      : clamp(set.temperature, -100, 100);
  }
  if (typeof set.tint === "number") {
    next.tint = raw ? clamp(set.tint, -150, 150) : clamp(set.tint, -100, 100);
  }
  if (typeof set.denoise === "number") {
    next.denoise = clamp(set.denoise, 0, 100);
  }
  if (typeof set.cropAngle === "number") {
    next.cropAngle = clamp(set.cropAngle, -45, 45);
  }
  if (set.rotation !== undefined) {
    if (![0, 90, 180, 270].includes(set.rotation)) {
      throw new Error("rotation is 0, 90, 180 or 270");
    }
    next.rotation = set.rotation;
  }
  if (set.crop) next.crop = saneCrop(set.crop);
  return next;
}

function saneCrop(crop: CropRect): CropRect {
  const { left, top, right, bottom } = crop;
  const fractions = [left, top, right, bottom];
  if (
    fractions.some((value) => value < 0 || value > 1) ||
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
          if (shown.some((image) => !current.current.visible.includes(image))) {
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
          const edits = new Map<string, Edit>();
          for (const photo of photos) {
            const now = view.editOf(photo);
            const next = agentEdit(
              call.args.reset ? identityEdit : now,
              call.args.set,
              photo.isRaw,
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
          return { files: await view.trash(paths) };
        }
      }
    };

    const subscription = listen<Request>("agent:request", ({ payload }) => {
      const { id } = payload;
      handle(payload).then(
        (value) => invoke("agent_reply", { id, ok: true, value }),
        (error: unknown) =>
          invoke("agent_reply", {
            id,
            ok: false,
            value: error instanceof Error ? error.message : String(error),
          }),
      );
    });
    subscription.then(() => invoke("agent_attach")).catch(() => {});
    return () => {
      void subscription.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [enabled]);
}
