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

type Description = { icon: LucideIcon; label: string; detail?: string };

const signed = (value: number, digits = 0) =>
  `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;

type SliderKey =
  | "highlights"
  | "shadows"
  | "whites"
  | "blacks"
  | "texture"
  | "clarity"
  | "dehaze"
  | "tint"
  | "denoise"
  | "vibrance"
  | "saturation";

const SLIDERS: [SliderKey, LucideIcon, string][] = [
  ["highlights", Contrast, "Highlights"],
  ["shadows", Contrast, "Shadows"],
  ["whites", Contrast, "Whites"],
  ["blacks", Contrast, "Blacks"],
  ["texture", Sparkles, "Texture"],
  ["clarity", Sparkles, "Clarity"],
  ["dehaze", Sparkles, "Dehaze"],
  ["tint", Thermometer, "Tint"],
  ["denoise", Sparkles, "Denoise"],
  ["vibrance", Droplet, "Vibrance"],
  ["saturation", Droplet, "Saturation"],
];

const CURVES: ["curveRGB" | "curveRed" | "curveGreen" | "curveBlue", string][] =
  [
    ["curveRGB", "RGB"],
    ["curveRed", "Red"],
    ["curveGreen", "Green"],
    ["curveBlue", "Blue"],
  ];

const FRAMING: (keyof Edit)[] = ["crop", "cropAngle", "rotation"];

export function describeEdit(before: Edit, after: Edit): Description {
  if (isIdentityEdit(after)) return { icon: RotateCcw, label: "Reset all" };

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
  if (changed("temperature")) {
    found.push({
      icon: Thermometer,
      label: "Temperature",
      detail:
        after.temperature == null
          ? "reset"
          : String(Math.round(after.temperature)),
    });
  }
  for (const [key, icon, label] of SLIDERS) {
    if (!changed(key)) continue;
    const value = after[key];
    found.push({
      icon,
      label,
      detail: value == null ? "reset" : signed(value),
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
  return {
    icon: SlidersHorizontal,
    label: "Edit",
    detail: `${found.length} settings`,
  };
}
