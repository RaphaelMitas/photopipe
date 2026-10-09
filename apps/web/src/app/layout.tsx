import type { Metadata, Viewport } from "next";
import { Inter, Montserrat } from "next/font/google";
import "./globals.css";
import { DESCRIPTION, SITE_URL } from "@/lib/site";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-montserrat",
  display: "swap",
});

export const viewport: Viewport = {
  themeColor: "#16181D",
};

const title = "Photopipe: free raw photo editor and culling app for Mac";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: title,
    template: "%s — Photopipe",
  },
  description: DESCRIPTION,
  alternates: {
    canonical: "/",
    types: { "text/markdown": "/llms-full.txt" },
  },
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title,
    description: DESCRIPTION,
    url: SITE_URL,
    siteName: "Photopipe",
    type: "website",
    images: [{ url: "/og-dark.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description: DESCRIPTION,
    images: ["/og-dark.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`dark ${inter.variable} ${montserrat.variable}`}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
