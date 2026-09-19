import type { Edit } from "./core";

export type SliderSpec = {
  key: keyof Pick<
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
  label: string;
  short: string;
  trackClassName?: string;
};

export const TONE_SLIDERS: SliderSpec[] = [
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

export const COLOR_SLIDERS: SliderSpec[] = [
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
