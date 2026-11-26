import type { ImageLoaderProps } from "next/image";
import { screenshotVariant } from "./screenshot-widths";

export default function screenshotLoader({ src, width }: ImageLoaderProps) {
  return screenshotVariant(src, width);
}
