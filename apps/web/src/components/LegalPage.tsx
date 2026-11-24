import { SiteFooter } from "@/components/SiteFooter";
import { SiteNav } from "@/components/SiteNav";

export function LegalPage({
  title,
  lang,
  children,
}: {
  title: string;
  lang?: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <SiteNav />
      <main
        lang={lang}
        className="mx-auto w-full max-w-3xl px-6 py-20 md:py-28"
      >
        <h1 className="font-heading text-4xl tracking-tight md:text-5xl">
          {title}
        </h1>
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
