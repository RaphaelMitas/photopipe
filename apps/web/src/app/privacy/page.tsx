import type { Metadata } from "next";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteNav } from "@/components/SiteNav";
import { downloadUrl, REPO } from "@/lib/release";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "Photopipe has no account and no telemetry. Your photos stay on your Mac.",
};

const SECTIONS = [
  {
    title: "The app",
    body: [
      "Photopipe has no account, no telemetry and no crash reporting. It reads the folders you open and writes ratings, edits and exports back to your disk. Your photos never leave your Mac.",
      "The app makes one kind of network request. On launch, and when you pick Check for Updates, it asks GitHub whether a newer release exists. If you install the update, it downloads that from GitHub too. GitHub sees your IP address when this happens, as with any download.",
    ],
  },
  {
    title: "This website",
    body: [
      "photopipe.net sets no cookies and runs no analytics or tracking scripts. The fonts ship with the site, so your browser makes no request to Google.",
      "Vercel hosts the site. Like any web host, Vercel processes your IP address and keeps short-lived server logs to deliver pages and block abuse.",
      "The download button and the other links in the footer point to GitHub. Once you follow them, GitHub's privacy statement applies.",
    ],
  },
];

export default async function Privacy() {
  const href = await downloadUrl();

  return (
    <>
      <SiteNav href={href} />
      <main className="mx-auto w-full max-w-3xl px-6 py-20 md:py-28">
        <h1 className="font-heading text-4xl tracking-tight md:text-5xl">
          Privacy
        </h1>
        {SECTIONS.map((section) => (
          <section key={section.title} className="mt-12">
            <h2 className="font-heading text-2xl tracking-tight">
              {section.title}
            </h2>
            {section.body.map((paragraph) => (
              <p
                key={paragraph}
                className="mt-4 text-muted-foreground leading-relaxed"
              >
                {paragraph}
              </p>
            ))}
          </section>
        ))}
        <section className="mt-12">
          <h2 className="font-heading text-2xl tracking-tight">Contact</h2>
          <p className="mt-4 text-muted-foreground leading-relaxed">
            Raphael Mitas builds Photopipe. Questions about this page go to the{" "}
            <a
              href={`${REPO}/issues`}
              className="text-foreground underline underline-offset-4"
            >
              issue tracker
            </a>
            .
          </p>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
