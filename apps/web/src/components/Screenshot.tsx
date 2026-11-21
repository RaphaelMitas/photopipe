import Image from "next/image";

export const SCREENSHOTS = [
  "hero",
  "cull",
  "instinct",
  "develop",
  "export",
] as const;

export type ScreenshotName = (typeof SCREENSHOTS)[number];

export type ScreenshotImage = { name: ScreenshotName; alt: string };

type Props = ScreenshotImage & { sizes: string; preload?: boolean };

export function Screenshot({ name, alt, sizes, preload }: Props) {
  return (
    <Image
      src={`/screenshots/${name}.jpg`}
      alt={alt}
      width={2880}
      height={1800}
      sizes={sizes}
      preload={preload}
      fetchPriority={preload ? "high" : "auto"}
      className="w-full rounded-xl border border-border shadow-2xl shadow-black/40"
    />
  );
}
