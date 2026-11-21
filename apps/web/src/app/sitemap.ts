import type { MetadataRoute } from "next";
import { INTENT_PAGES } from "@/lib/intent-pages";
import { SITE_URL } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE_URL, priority: 1 },
    ...INTENT_PAGES.map((page) => ({
      url: `${SITE_URL}/${page.slug}`,
      priority: 0.8,
    })),
    { url: `${SITE_URL}/privacy`, priority: 0.3 },
  ];
}
