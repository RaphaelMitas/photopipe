type Props = {
  eyebrow: string;
  title: string;
  lede?: string;
  children?: React.ReactNode;
};

export function Section({ eyebrow, title, lede, children }: Props) {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-20 md:py-28">
      <p className="font-medium text-primary text-sm uppercase tracking-[0.14em]">
        {eyebrow}
      </p>
      <h2 className="mt-3 max-w-3xl font-heading text-3xl tracking-tight md:text-5xl">
        {title}
      </h2>
      {lede ? (
        <p className="mt-5 max-w-3xl text-balance text-lg text-muted-foreground leading-relaxed">
          {lede}
        </p>
      ) : null}
      {children}
    </section>
  );
}
