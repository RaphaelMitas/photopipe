import type { ImageLoaderProps } from "next/image";

export const SCREENSHOT_WIDTHS = [640, 1080, 1600, 2880];

export default function screenshotLoader({ src, width }: ImageLoaderProps) {
  return `${src.replace(/\.jpg$/, "")}-${width}.webp`;
}
