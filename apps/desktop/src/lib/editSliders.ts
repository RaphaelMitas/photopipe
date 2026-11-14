import type { Edit } from "./core";

export const EXPOSURE_STEP = 0.25;
export const EXPOSURE_RANGE = 3;
export const SLIDER_RANGE = 100;
export const SIGNED_RANGE = { min: -SLIDER_RANGE, max: SLIDER_RANGE };
export const DENOISE_RANGE = { min: 0, max: SLIDER_RANGE };

// kelvin for a raw's own white balance; masks and other files are an offset from neutral
export const temperatureRange = (kelvin: boolean) =>
  kelvin ? { min: 2000, max: 12000 } : SIGNED_RANGE;

/// An offset at zero is no adjustment at all, so it is stored as none.
export const storedBalance = (kelvin: boolean, value: number) =>
  !kelvin && value === 0 ? null : value;

export const tintRange = (kelvin: boolean) => {
  const reach = kelvin ? 150 : SLIDER_RANGE;
  return { min: -reach, max: reach };
};

type SliderKey = keyof Pick<
  Edit,
  | "highlights"
  | "shadows"
  | "whites"
  | "blacks"
  | "texture"
  | "clarity"
  | "dehaze"
  | "vibrance"
  | "saturation"
>;

export type SliderSpec<Key extends SliderKey = SliderKey> = {
  key: Key;
  label: string;
  short: string;
  trackClassName?: string;
};

export const TONE_SLIDERS: SliderSpec<
  "highlights" | "shadows" | "whites" | "blacks"
>[] = [
  { key: "highlights", label: "Highlights", short: "hl" },
  { key: "shadows", label: "Shadows", short: "sh" },
  { key: "whites", label: "Whites", short: "wh" },
  { key: "blacks", label: "Blacks", short: "bl" },
];

export const PRESENCE_SLIDERS: SliderSpec[] = [
  { key: "texture", label: "Texture", short: "tex" },
  { key: "clarity", label: "Clarity", short: "cl" },
  { key: "dehaze", label: "Dehaze", short: "dh" },
];

export const COLOR_SLIDERS: SliderSpec<"vibrance" | "saturation">[] = [
  {
    key: "vibrance",
    label: "Vibrance",
    short: "vib",
    trackClassName: "bg-gradient-to-r from-zinc-500/60 to-teal-400/70",
  },
  {
    key: "saturation",
    label: "Saturation",
    short: "sat",
    trackClassName: "bg-gradient-to-r from-zinc-500/60 to-orange-400/70",
  },
];

export const signed = (value: number, digits = 0) =>
  `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;

export const kelvin = (value: number) => `${Math.round(value)} K`;
