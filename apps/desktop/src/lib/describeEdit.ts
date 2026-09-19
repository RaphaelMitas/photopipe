import {
  Contrast,
  Crop,
  Droplet,
  type LucideIcon,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Spline,
  Sun,
  Thermometer,
} from "lucide-react";
import { type Edit, editKey, isIdentityEdit } from "./core";
import { CURVE_CHANNELS, isIdentityCurve } from "./curve";
import {
  COLOR_SLIDERS,
  PRESENCE_SLIDERS,
  type SliderSpec,
  signed,
  TONE_SLIDERS,
} from "./editSliders";

type Description = { icon: LucideIcon; label: string; detail?: string };

const SLIDER_GROUPS: [SliderSpec[], LucideIcon][] = [
  [TONE_SLIDERS, Contrast],
  [PRESENCE_SLIDERS, Sparkles],
  [COLOR_SLIDERS, Droplet],
];

const FRAMING = ["crop", "cropAngle", "rotation"] as const;

export function describeEdit(
  before: Edit,
  after: Edit,
  raw: boolean,
): Description {
  const changed = (key: keyof Edit) =>
    editKey({ ...before, [key]: after[key] }) !== editKey(before);
  const orReset = (value: number | null | undefined, format = signed) =>
    value == null ? "reset" : format(value);
  const kelvin = (value: number) => `${Math.round(value)} K`;
  const scalars: [keyof Edit, LucideIcon, string, string][] = [
    ["exposure", Sun, "Exposure", signed(after.exposure, 2)],
    [
      "temperature",
      Thermometer,
      "Temperature",
      orReset(after.temperature, raw ? kelvin : signed),
    ],
    ["tint", Thermometer, "Tint", orReset(after.tint)],
    ["denoise", Sparkles, "Denoise", orReset(after.denoise)],
  ];
  const found: Description[] = [];

  for (const [key, icon, label, detail] of scalars) {
    if (changed(key)) found.push({ icon, label, detail });
  }
  for (const [sliders, icon] of SLIDER_GROUPS) {
    for (const { key, label } of sliders) {
      if (changed(key)) found.push({ icon, label, detail: signed(after[key]) });
    }
  }
  for (const { key, label } of CURVE_CHANNELS) {
    if (!changed(key)) continue;
    found.push({
      icon: Spline,
      label: "Curve",
      detail: isIdentityCurve(after[key]) ? `${label} reset` : label,
    });
  }
  if (FRAMING.some(changed)) {
    found.push({ icon: Crop, label: "Crop & straighten" });
  }

  if (found.length === 1) return found[0];
  if (isIdentityEdit(after)) return { icon: RotateCcw, label: "Reset all" };
  return {
    icon: SlidersHorizontal,
    label: "Edit",
    detail: `${found.length} settings`,
  };
}
