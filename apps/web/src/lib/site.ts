import type { Metadata } from "next";

export const SITE_URL = "https://photopipe.net";

export const TITLE = "Photopipe: free raw photo editor and culling app for Mac";

export const DESCRIPTION =
  "Free raw photo editor for Mac: cull, edit and export in one app. On-device AI ranks every shot, and edits save as XMP that Lightroom reads.";

export function socialMetadata(page: {
  title: string;
  description: string;
  url: string;
}) {
  return {
    openGraph: {
      ...page,
      siteName: "Photopipe",
      type: "website",
      images: [{ url: "/og-dark.png", width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: page.title,
      description: page.description,
      images: ["/og-dark.png"],
    },
  } satisfies Metadata;
}
