import type { Metadata } from "next";
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
  "A free culling and develop suite for macOS. Apple's raw decoder, Neural Engine denoise, curves, crop and aesthetic scoring, all of it on your own machine, over your own folders.";

export const metadata: Metadata = {
  metadataBase: new URL("https://photopipe.net"),
  title: {
    default: "Photopipe — from 2000 raws to the ones you'll send",
    template: "%s — Photopipe",
  },
  description,
  openGraph: {
    title: "Photopipe",
    description,
    url: "https://photopipe.net",
    siteName: "Photopipe",
    type: "website",
    images: [{ url: "/screenshots/browse.png", width: 2560, height: 1600 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Photopipe",
    description,
    images: ["/screenshots/browse.png"],
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
