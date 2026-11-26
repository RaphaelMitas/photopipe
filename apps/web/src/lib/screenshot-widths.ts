export const SCREENSHOT_WIDTHS = [640, 1080, 1600, 2880] as const;

export function screenshotVariant(src: string, width: number) {
  return `${src.replace(/\.jpg$/, "")}-${width}.webp`;
}
