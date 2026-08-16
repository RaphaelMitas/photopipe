import { Separator } from "@photopipe/ui/components/separator";
import Image from "next/image";
import { Section } from "@/components/Section";

const CONTROLS = [
  { name: "Exposure", detail: "Written as Lightroom's own crs:Exposure2012." },
  { name: "Highlights · Shadows", detail: "Recovery either end of the range." },
  { name: "Temp · Tint", detail: "True Kelvin on raw, incremental elsewhere." },
  {
    name: "Denoise",
    detail: "RAW 9 demosaics and denoises in one model, on the Neural Engine.",
  },
  {
    name: "Vibrance · Saturation",
    detail: "Two separate controls, as they should be.",
  },
  { name: "Curves", detail: "RGB plus a red, green and blue channel each." },
  {
    name: "Crop, straighten, rotate",
    detail: "Live angle, non-destructive, zoom to 1:1 to check focus.",
  },
  {
    name: "⌘C / ⌘V",
    detail: "Copy a look from one photo, paste it onto the whole selection.",
  },
];

export function DevelopSection() {
  return (
    <Section
      eyebrow="Develop"
      title="A real edit, not a preview."
      lede="Every adjustment runs through Apple's raw pipeline at full precision and is written back as XMP. Warm re-renders land in 32 ms on a 33 MP ARW, so a slider moves the photo, not a progress bar."
    >
      <div className="mt-12 grid items-start gap-10 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <ul className="flex flex-col">
          {CONTROLS.map((control, index) => (
            <li key={control.name}>
              {index > 0 ? <Separator /> : null}
              <div className="py-3">
                <p className="font-medium">{control.name}</p>
                <p className="text-muted-foreground text-sm">
                  {control.detail}
                </p>
              </div>
            </li>
          ))}
        </ul>
        <Image
          src="/screenshots/loupe.png"
          alt="The Photopipe loupe with the edit panel open on a raw file"
          width={2560}
          height={1600}
          sizes="(min-width: 1024px) 60vw, 100vw"
          className="w-full rounded-xl border border-border shadow-2xl shadow-black/40"
        />
      </div>
    </Section>
  );
}
