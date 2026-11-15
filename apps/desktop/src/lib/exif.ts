import type { Exif } from "./core";

export function shutterText(seconds: number) {
  const denominator = Math.round(1 / seconds);
  const fraction =
    seconds < 0.25 ||
    (seconds < 0.4 && Math.abs(1 / seconds - denominator) < 0.05);
  return fraction ? `1/${denominator}` : `${Number(seconds.toFixed(1))} s`;
}

export const fNumber = (aperture: number) => Number(aperture.toFixed(2));

export const focalMm = (focal: number) => Math.round(focal);

export function exposureParts(exif: Exif): string[] {
  return [
    exif.shutter && shutterText(exif.shutter),
    exif.aperture && `f/${fNumber(exif.aperture)}`,
    exif.iso && `ISO ${exif.iso}`,
    exif.focal && `${focalMm(exif.focal)}mm`,
  ].filter((part) => typeof part === "string");
}

const day = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const time = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "UTC",
});

export const takenTime = (captured: number) => time.format(captured * 1000);

export const takenText = (captured: number) =>
  `${day.format(captured * 1000)} · ${takenTime(captured)}`;
