import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CloseSection } from "@/components/CloseSection";
import { ComparisonSection } from "@/components/ComparisonSection";
import { FaqSection } from "@/components/FaqSection";
import { Hero } from "@/components/Hero";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteNav } from "@/components/SiteNav";
import { StructuredData } from "@/components/StructuredData";
import { INTENT_PAGES } from "@/lib/intent-pages";
import { downloadUrl, latestVersion } from "@/lib/release";

type Props = { params: Promise<{ slug: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return INTENT_PAGES.map(({ slug }) => ({ slug }));
}

async function pageFor({ params }: Props) {
  const { slug } = await params;
  return INTENT_PAGES.find((page) => page.slug === slug) ?? notFound();
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const page = await pageFor(props);
  const url = `/${page.slug}`;

  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: url },
    openGraph: {
      title: `${page.title} — Photopipe`,
      description: page.description,
      url,
      images: ["/og-dark.png"],
    },
  };
}

export default async function IntentPage(props: Props) {
  const page = await pageFor(props);
  const version = await latestVersion();
  const href = downloadUrl(version);

  return (
    <>
      <StructuredData version={version} href={href} faq={page.faq} />
      <SiteNav />
      <main>
        <Hero
          href={href}
          eyebrow={page.title}
          title={page.headline}
          lede={page.lede}
          screenshot={page.screenshot}
        />
        <ComparisonSection page={page} />
        <FaqSection items={page.faq} />
      </main>
      <CloseSection href={href} version={version} />
      <SiteFooter />
    </>
  );
}
