import { InstallOptions } from "@/components/InstallOptions";
import { Screenshot, type ScreenshotImage } from "@/components/Screenshot";

type Props = {
  href: string;
  brew?: boolean;
  eyebrow: string;
  title: React.ReactNode;
  lede: string;
  screenshot: ScreenshotImage;
};

export function Hero({ href, brew, eyebrow, title, lede, screenshot }: Props) {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="-translate-x-1/2 pointer-events-none absolute top-[-18rem] left-1/2 h-[36rem] w-[72rem] rounded-full bg-primary/12 blur-3xl"
      />
      <div className="relative mx-auto w-full max-w-6xl px-6 pt-20 pb-12 text-center md:pt-28">
        <h1 className="mx-auto max-w-4xl text-balance font-heading text-5xl leading-[1.05] tracking-tight md:text-7xl">
          <span className="mb-5 block font-medium font-sans text-primary text-sm uppercase tracking-[0.14em]">
            {eyebrow}
            <span className="sr-only">.</span>
          </span>{" "}
          {title}
        </h1>
        <p className="mx-auto mt-7 max-w-2xl text-balance text-lg text-muted-foreground leading-relaxed md:text-xl">
          {lede}
        </p>
        <InstallOptions href={href} brew={brew} />
        <p className="mt-6 text-muted-foreground text-sm">
          Free and open source (MIT) · macOS 15 or later · Apple Silicon · your
          photos never leave your Mac
        </p>
      </div>
      <div className="relative mx-auto w-full max-w-7xl px-6 pb-8">
        <Screenshot
          {...screenshot}
          sizes="(min-width: 1280px) 1232px, calc(100vw - 48px)"
          preload
        />
      </div>
    </section>
  );
}
