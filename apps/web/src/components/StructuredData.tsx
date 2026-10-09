import { FAQ } from "@/lib/faq";
import { APP_STORE, REPO } from "@/lib/release";
import { DESCRIPTION, SITE_URL } from "@/lib/site";

export function StructuredData({
  version,
  href,
}: {
  version: string | null;
  href: string;
}) {
  const app = {
    "@type": "SoftwareApplication",
    name: "Photopipe",
    url: SITE_URL,
    description: DESCRIPTION,
    applicationCategory: "MultimediaApplication",
    applicationSubCategory: "Raw photo editing and culling",
    operatingSystem: "macOS 15 or later",
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
      `${SITE_URL}/screenshots/browse.png`,
      `${SITE_URL}/screenshots/loupe.png`,
    ],
    downloadUrl: href,
    installUrl: APP_STORE,
    sameAs: [REPO, APP_STORE],
  };
  const faq = {
    "@type": "FAQPage",
    mainEntity: FAQ.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
  const data = { "@context": "https://schema.org", "@graph": [app, faq] };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
