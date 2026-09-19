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

const CURVES = [
  ["curveRGB", "RGB"],
  ["curveRed", "Red"],
  ["curveGreen", "Green"],
  ["curveBlue", "Blue"],
] as const;

const FRAMING = ["crop", "cropAngle", "rotation"] as const;

const orReset = (value: number | null | undefined, format = signed) =>
  value == null ? "reset" : format(value);

export function describeEdit(before: Edit, after: Edit): Description {
  const changed = (key: keyof Edit) =>
    editKey({ ...before, [key]: after[key] }) !== editKey(before);
  const found: Description[] = [];

  if (changed("exposure")) {
    found.push({
      icon: Sun,
      label: "Exposure",
      detail: signed(after.exposure, 2),
    });
  }
  for (const [sliders, icon] of SLIDER_GROUPS) {
    for (const { key, label } of sliders) {
      if (changed(key)) found.push({ icon, label, detail: signed(after[key]) });
    }
  }
  if (changed("temperature")) {
    found.push({
      icon: Thermometer,
      label: "Temperature",
      detail: orReset(after.temperature, (kelvin) =>
        String(Math.round(kelvin)),
      ),
    });
  }
  if (changed("tint")) {
    found.push({
      icon: Thermometer,
      label: "Tint",
      detail: orReset(after.tint),
    });
  }
  if (changed("denoise")) {
    found.push({
      icon: Sparkles,
      label: "Denoise",
      detail: orReset(after.denoise),
    });
  }
  for (const [key, channel] of CURVES) {
    if (!changed(key)) continue;
    found.push({
      icon: Spline,
      label: "Curve",
      detail: after[key].length === 0 ? `${channel} reset` : channel,
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
