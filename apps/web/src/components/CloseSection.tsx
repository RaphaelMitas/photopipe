import { InstallOptions } from "@/components/InstallOptions";

const FACTS = [
  "macOS 15 (Sequoia) or later",
  "Apple Silicon",
  "No account",
  "Photos never leave your Mac",
];

export function CloseSection({
  href,
  brew,
  version,
}: {
  href: string;
  brew?: boolean;
  version: string | null;
}) {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="-translate-x-1/2 pointer-events-none absolute bottom-[-20rem] left-1/2 h-[32rem] w-[64rem] rounded-full bg-primary/12 blur-3xl"
      />
      <div className="relative mx-auto w-full max-w-6xl px-6 py-24 text-center md:py-32">
        <h2 className="font-heading text-4xl tracking-tight md:text-5xl">
          Your next shoot is waiting.
        </h2>
        <p className="mt-4 text-lg text-muted-foreground">
          Free and open source{version ? `, version ${version}` : ""}.
        </p>
        <InstallOptions href={href} brew={brew} />
        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-muted-foreground text-sm">
          {FACTS.map((fact) => (
            <span key={fact}>{fact}</span>
          ))}
        </div>
      </div>
    </section>
  );
}
