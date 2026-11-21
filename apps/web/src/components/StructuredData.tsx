import type { ScreenshotName } from "@/components/Screenshot";
import type { FaqItem } from "@/lib/faq";
import { APP_STORE, REPO } from "@/lib/release";
import { DESCRIPTION, SITE_URL } from "@/lib/site";

export function StructuredData({
  version,
  href,
  url,
  title,
  image,
  updated,
  faq,
}: {
  version: string | null;
  href: string;
  url: string;
  title: string;
  image: ScreenshotName;
  updated?: string;
  faq: FaqItem[];
}) {
  const site = {
    "@type": "WebSite",
    "@id": `${SITE_URL}/#site`,
    url: SITE_URL,
    name: "Photopipe",
  };
  const app = {
    "@type": "SoftwareApplication",
    "@id": `${SITE_URL}/#app`,
    name: "Photopipe",
    url: SITE_URL,
    description: DESCRIPTION,
    applicationCategory: "MultimediaApplication",
    applicationSubCategory: "Raw photo editing and culling",
    operatingSystem: "macOS 15 or later, iPadOS 18 or later",
    processorRequirements: "Apple Silicon",
    softwareVersion: version ?? undefined,
    license: `${REPO}/blob/main/LICENSE`,
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: 0, priceCurrency: "USD" },
    author: {
      "@type": "Person",
      name: "Raphael Mitas",
      url: "https://raphaelmitas.com",
    },
    image: `${SITE_URL}/og-dark.png`,
    screenshot: [
      `${SITE_URL}/screenshots/hero.jpg`,
      `${SITE_URL}/screenshots/develop.jpg`,
    ],
    downloadUrl: href,
    installUrl: APP_STORE,
    sameAs: [REPO, APP_STORE],
  };
  const faqPage = {
    "@type": "FAQPage",
    "@id": url,
    url,
    name: title,
    dateModified: updated,
    primaryImageOfPage: `${SITE_URL}/screenshots/${image}.jpg`,
    isPartOf: { "@id": site["@id"] },
    about: { "@id": app["@id"] },
    mainEntity: faq.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
  const data = {
    "@context": "https://schema.org",
    "@graph": [site, app, faqPage],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
