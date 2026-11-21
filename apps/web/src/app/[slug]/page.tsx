import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CloseSection } from "@/components/CloseSection";
import { ComparisonSection } from "@/components/ComparisonSection";
import { FaqSection } from "@/components/FaqSection";
import { Hero } from "@/components/Hero";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteNav } from "@/components/SiteNav";
import { StructuredData } from "@/components/StructuredData";
import { WorkflowSection } from "@/components/WorkflowSection";
import { INTENT_PAGES } from "@/lib/intent-pages";
import { downloadUrl, latestVersion } from "@/lib/release";
import { SITE_URL, socialMetadata } from "@/lib/site";

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
    ...socialMetadata({
      title: `${page.title} — Photopipe`,
      description: page.description,
      url,
    }),
  };
}

export default async function IntentPage(props: Props) {
  const page = await pageFor(props);
  const version = await latestVersion();
  const href = downloadUrl(version);

  return (
    <>
      <StructuredData
        version={version}
        href={href}
        url={`${SITE_URL}/${page.slug}`}
        title={page.title}
        image={page.screenshot.name}
        updated={page.updated}
        faq={page.faq}
      />
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
        <div id="workflow">
          <WorkflowSection workflow={page.workflow} />
        </div>
        <FaqSection title={page.faqTitle} items={page.faq} />
      </main>
      <CloseSection href={href} version={version} />
      <SiteFooter />
    </>
  );
}
