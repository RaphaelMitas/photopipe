import type { Metadata, Viewport } from "next";
import { Inter, Montserrat } from "next/font/google";
import "./globals.css";

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

const description =
  "A free culling and develop suite for macOS. Apple's latest raw decoder, Neural Engine denoise, curves, crop and Vision aesthetic scoring, all of it on your own machine, over your own folders.";

export const viewport: Viewport = {
  themeColor: "#16181D",
};

export const metadata: Metadata = {
  metadataBase: new URL("https://photopipe.net"),
  title: {
    default: "Photopipe — from 2000 raws to the ones you'll send",
    template: "%s — Photopipe",
  },
  description,
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: "Photopipe",
    description,
    url: "https://photopipe.net",
    siteName: "Photopipe",
    type: "website",
    images: [{ url: "/og-dark.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Photopipe",
    description,
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
