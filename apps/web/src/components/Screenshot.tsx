import Image from "next/image";

type Props = {
  name: "hero" | "cull" | "instinct" | "develop" | "export";
  alt: string;
  sizes: string;
  preload?: boolean;
};

export function Screenshot({ name, alt, sizes, preload }: Props) {
  return (
    <Image
      src={`/screenshots/${name}.jpg`}
      alt={alt}
      width={2880}
      height={1800}
      sizes={sizes}
      preload={preload}
      className="w-full rounded-xl border border-border shadow-2xl shadow-black/40"
    />
  );
}
