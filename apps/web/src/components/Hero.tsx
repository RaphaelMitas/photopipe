import Image from "next/image";
import { BrewCommand } from "@/components/BrewCommand";
import { DownloadButton } from "@/components/DownloadButton";

export function Hero({ href }: { href: string }) {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="-translate-x-1/2 pointer-events-none absolute top-[-18rem] left-1/2 h-[36rem] w-[72rem] rounded-full bg-primary/12 blur-3xl"
      />
      <div className="relative mx-auto w-full max-w-6xl px-6 pt-20 pb-12 text-center md:pt-28">
        <h1 className="mx-auto max-w-4xl text-balance font-heading text-5xl leading-[1.05] tracking-tight md:text-7xl">
          From 2000 raws to the ones you&rsquo;ll{" "}
          <span className="text-primary">send</span>.
        </h1>
        <p className="mx-auto mt-7 max-w-2xl text-balance text-lg text-muted-foreground leading-relaxed md:text-xl">
          A free culling and develop suite for macOS. Apple&rsquo;s latest raw
          decoder, Neural Engine denoise, curves, crop and Vision aesthetic
          scoring, all of it on your own machine, over your own folders. No
          catalogue, no import, no account.
        </p>
        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <DownloadButton href={href}>Download for macOS</DownloadButton>
          <BrewCommand />
        </div>
        <p className="mt-6 text-muted-foreground text-sm">
          Free and open source · macOS 15 or later · Apple Silicon · nothing is
          uploaded, ever
        </p>
      </div>
      <div className="relative mx-auto w-full max-w-7xl px-6 pb-8">
        <Image
          src="/screenshots/browse.png"
          alt="The Photopipe browse grid, a shoot sorted by Instinct score"
          width={2560}
          height={1600}
          priority
          sizes="(min-width: 1536px) 1440px, 100vw"
          className="w-full rounded-xl border border-border shadow-2xl shadow-black/40"
        />
      </div>
    </section>
  );
}
