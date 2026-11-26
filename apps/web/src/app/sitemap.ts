import type { MetadataRoute } from "next";
import { INTENT_PAGES } from "@/lib/intent-pages";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE_URL, priority: 1 },
    ...INTENT_PAGES.map((page) => ({
      url: `${SITE_URL}/${page.slug}`,
      lastModified: page.updated,
      priority: 0.8,
    })),
    { url: `${SITE_URL}/privacy`, priority: 0.3 },
    { url: `${SITE_URL}/imprint`, priority: 0.1 },
  ];
}
