import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { CurvePoint } from "./curve";
import { placeholderFor } from "./placeholder";

export type CropRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

const ADJUST_KEYS = [
  "exposure",
  "highlights",
  "shadows",
  "whites",
  "blacks",
  "temperature",
  "tint",
  "vibrance",
  "saturation",
] as const;

export type LocalAdjust = Record<(typeof ADJUST_KEYS)[number], number>;

export type MaskSource = "subject" | "people" | "click";

export type MaskPoint = { x: number; y: number; include: boolean };

export type MaskShape = {
  source: MaskSource;
  inverted: boolean;
  points: MaskPoint[];
};

export type Mask = MaskShape & {
  id: string;
  hidden: boolean;
  adjust: LocalAdjust;
};

export const identityAdjust: LocalAdjust = Object.freeze({
  exposure: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  temperature: 0,
  tint: 0,
  vibrance: 0,
  saturation: 0,
});

export function maskName({ source, inverted }: MaskShape): string {
  if (source === "subject") return inverted ? "Background" : "Subject";
  if (source === "people") return inverted ? "Not people" : "People";
  return inverted ? "Not object" : "Object";
}

export type Edit = {
  exposure: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  texture: number;
  clarity: number;
  dehaze: number;
  temperature?: number | null;
  tint?: number | null;
  denoise?: number | null;
  vibrance: number;
  saturation: number;
  curveRGB: CurvePoint[];
  curveRed: CurvePoint[];
  curveGreen: CurvePoint[];
  curveBlue: CurvePoint[];
  crop?: CropRect | null;
  cropAngle?: number;
  rotation?: number;
  masks: Mask[];
};

export const identityEdit: Edit = Object.freeze({
  exposure: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  texture: 0,
  clarity: 0,
  dehaze: 0,
  temperature: null,
  tint: null,
  denoise: null,
  vibrance: 0,
  saturation: 0,
  curveRGB: [],
  curveRed: [],
  curveGreen: [],
  curveBlue: [],
  crop: null,
  cropAngle: 0,
  rotation: 0,
  masks: [],
});

export function framing(edit: Edit) {
  return {
    crop: edit.crop ?? null,
    cropAngle: edit.cropAngle ?? 0,
    rotation: edit.rotation ?? 0,
  };
}

export const unedited = (edit: Edit): Edit => ({
  ...identityEdit,
  ...framing(edit),
});

export function isIdentityEdit(edit: Edit): boolean {
  return editKey(edit) === editKey(identityEdit);
}

const pointsKey = (points: MaskPoint[]) =>
  points.map((point) => `${point.x}:${point.y}:${point.include}`).join("/");

export const shapeKey = ({ source, inverted, points }: MaskShape) =>
  `${source}|${inverted}|${pointsKey(points)}`;

export function editKey(edit: Edit): string {
  const curve = (points: CurvePoint[]) =>
    points.map((point) => `${point.x},${point.y}`).join(";");
  const crop = edit.crop
    ? `${edit.crop.left},${edit.crop.top},${edit.crop.right},${edit.crop.bottom}`
    : "";
  const mask = (entry: Mask) =>
    [
      entry.id,
      shapeKey(entry),
      entry.hidden,
      ...ADJUST_KEYS.map((key) => entry.adjust[key]),
    ].join(",");
  return [
    edit.exposure,
    edit.highlights,
    edit.shadows,
    edit.whites,
    edit.blacks,
    edit.texture,
    edit.clarity,
    edit.dehaze,
    edit.temperature ?? "",
    edit.tint ?? "",
    edit.denoise ?? "",
    edit.vibrance,
    edit.saturation,
    curve(edit.curveRGB),
    curve(edit.curveRed),
    curve(edit.curveGreen),
    curve(edit.curveBlue),
    crop,
    edit.cropAngle ?? 0,
    edit.rotation ?? 0,
    edit.masks.map(mask).join(";"),
  ].join("|");
}

export type Flag = -1 | 0 | 1;

export type Exif = {
  shutter?: number;
  aperture?: number;
  iso?: number;
  focal?: number;
  lens?: string;
  body?: string;
};

export type ImageFile = {
  path: string;
  rel: string;
  size: number;
  mtime: number;
  rating: number;
  flag: Flag;
  edit: Edit;
  width: number;
  height: number;
  score: number | null;
  captured: number | null;
  taken: number;
  exif: Exif;
  stack: string | null;
  enriched: boolean;
  isRaw: boolean;
};

type WireImage = Omit<ImageFile, "score" | "captured" | "stack" | "edit"> & {
  score?: number | null;
  captured?: number | null;
  stack?: string | null;
  edit: WireEdit;
};

type WireMask = Pick<Mask, "id" | "source"> & {
  points?: MaskPoint[];
  inverted?: boolean;
  hidden?: boolean;
  adjust?: Partial<LocalAdjust>;
};

export type WireEdit = Partial<Omit<Edit, "masks">> & { masks?: WireMask[] };

export type PassProgress = { done: number; total: number; running: boolean };

export function normalizeEdit({ masks = [], ...edit }: WireEdit): Edit {
  return {
    ...identityEdit,
    ...edit,
    masks: masks.map((mask) => ({
      ...mask,
      points: mask.points ?? [],
      inverted: mask.inverted ?? false,
      hidden: mask.hidden ?? false,
      adjust: { ...identityAdjust, ...mask.adjust },
    })),
  };
}

export function normalizeImage(image: WireImage): ImageFile {
  return {
    ...image,
    score: image.score ?? null,
    captured: image.captured ?? null,
    stack: image.stack ?? null,
    edit: normalizeEdit(image.edit),
  };
}

export type Shoot = {
  name: string;
  path: string;
  day: string | null;
  imageCount: number;
  notes: string;
  cover: string | null;
  coverPath: string | null;
  indexed: boolean;
};

export const dayOutsideName = (shoot: Shoot) =>
  shoot.day !== null && !shoot.name.startsWith(shoot.day);

type WireShoot = Omit<Shoot, "day" | "cover" | "coverPath"> &
  Partial<Pick<Shoot, "day" | "cover" | "coverPath">>;

export function normalizeShoot(shoot: WireShoot): Shoot {
  return {
    ...shoot,
    day: shoot.day ?? null,
    cover: shoot.cover ?? null,
    coverPath: shoot.coverPath ?? null,
  };
}

export type ExportFormat = "original" | "jpeg";

export type ExportProgress = {
  id: string;
  done: number;
  failed: number;
  total: number;
  running: boolean;
  cancelled: boolean;
  archiving: boolean;
  error?: string | null;
  failures: string[];
};

export type SetRootResult = {
  shoots: number;
  files: number;
  generation: number;
};

export type StatusResult = {
  generation: number;
  root?: string | null;
  shoots: number;
  scanning: boolean;
  filesFound: number;
  filesEnriched: number;
  changedShoots?: string[];
};

type CachePath = { cachePath: string };

export type CoreMethods = {
  listShoots: { params: undefined; result: { shoots: WireShoot[] } };
  listImages: { params: { shoot: string }; result: { images: WireImage[] } };
  scoreShoot: { params: { shoot: string }; result: PassProgress };
  stackShoot: { params: { shoot: string }; result: PassProgress };
  thumbnail: { params: { path: string; maxPixel: number }; result: CachePath };
  render: {
    params: {
      path: string;
      edit: Edit;
      maxPixel: number;
      viewport?: CropRect;
      decoderVersion?: number;
    };
    result: CachePath & { unmasked: boolean };
  };
  maskOverlay: {
    params: MaskShape & { path: string; edit: Edit; maxPixel: number };
    result: CachePath;
  };
  maskAt: {
    params: MaskPoint & {
      path: string;
      edit: Edit;
      points: MaskPoint[];
      inverted: boolean;
      maxPixel: number;
    };
    result: { png: string; point: MaskPoint };
  };
  maskSupport: { params: undefined; result: { clicks: number } };
  rawDefaults: {
    params: { path: string; decoderVersion: number };
    result: {
      temperature: number | null;
      tint: number | null;
      denoise: number | null;
    };
  };
  decoderSupport: {
    params: { paths: string[] };
    result: { raw9: number; rawTotal: number };
  };
  decoderAvailability: { params: undefined; result: { raw9: boolean | null } };
  setRating: {
    params: { shoot: string | null; path: string; rating: number };
    result: { rating: number };
  };
  setFlag: {
    params: { shoot: string | null; path: string; flag: Flag };
    result: { flag: Flag };
  };
  setEdit: {
    params: { shoot: string | null; path: string; edit: Edit };
    result: { edit: WireEdit };
  };
  trash: {
    params: { shoot: string | null; paths: string[] };
    result: { files: number; generation: number };
  };
  createProject: {
    params: { name: string; notes: string };
    result: { shoot: string; path: string; generation: number };
  };
  updateProject: {
    params: {
      shoot: string;
      name: string;
      day: string | null;
      notes: string;
      cover: string | null;
    };
    result: { shoot: string; generation: number };
  };
  captureDate: { params: { path: string }; result: { day: string | null } };
  exportFiles: {
    params: {
      shoot: string;
      paths: string[];
      destination: string;
      zip: boolean;
      flatten: boolean;
      format: ExportFormat;
      quality: number;
      longEdge: number | null;
      decoderVersion: number;
      names: string[] | null;
    };
    result: ExportProgress;
  };
  importFiles: {
    params: { shoot: string; paths: string[] };
    result: ExportProgress;
  };
  exportStatus: { params: { id: string }; result: ExportProgress };
  cancelExport: { params: { id: string }; result: ExportProgress };
  status: { params: { since: number | null }; result: StatusResult };
  rescan: { params: undefined; result: Record<string, never> };
};

export function coreRequest<K extends keyof CoreMethods>(
  method: K,
  ...[params]: CoreMethods[K]["params"] extends undefined
    ? []
    : [CoreMethods[K]["params"]]
): Promise<CoreMethods[K]["result"]> {
  return invoke("core_request", { method, params });
}

export function fileSrc(path: string): string {
  try {
    return convertFileSrc(path);
  } catch {
    return URL.canParse(path) ? path : placeholderFor(path);
  }
}
