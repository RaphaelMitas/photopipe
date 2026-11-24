import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";
import { OperatorAddress } from "@/components/OperatorAddress";
import { TextLink } from "@/components/TextLink";
import { OPERATOR } from "@/lib/operator";
import { REPO } from "@/lib/release";

const description =
  "Photopipe has no account and no telemetry. Your photos stay on your Mac.";

export const metadata: Metadata = {
  title: "Privacy",
  description,
  alternates: { canonical: "/privacy" },
  openGraph: {
    title: "Privacy — Photopipe",
    description,
    url: "/privacy",
    images: ["/og-dark.png"],
  },
};

const SECTIONS = [
  {
    title: "The app",
    body: [
      "Photopipe has no account, no telemetry and no crash reporting. It reads the folders you open and writes ratings, edits and exports back to your disk. Your photos never leave your Mac.",
      "The app makes one kind of network request. On launch, and when you pick Check for Updates, it asks GitHub whether a newer release exists. If you install the update, it downloads that from GitHub too. GitHub sees your IP address when this happens, as with any download.",
      "The Mac App Store version makes no network requests at all. Apple delivers its updates.",
    ],
  },
  {
    title: "This website",
    body: [
      "photopipe.net sets no cookies and runs no analytics or tracking scripts. The fonts ship with the site, so your browser makes no request to Google.",
      "Vercel hosts the site. Like any web host, Vercel processes your IP address and keeps short-lived server logs to deliver pages and block abuse.",
      "The Download button and the App Store links lead to the Mac App Store, where Apple's privacy policy applies. The DMG download and the other links in the footer point to GitHub, where GitHub's privacy statement applies.",
    ],
  },
];

export default function Privacy() {
  return (
    <LegalPage title="Privacy">
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
          {OPERATOR.name} builds Photopipe and is the controller responsible for
          this website.
        </p>
        <OperatorAddress />
        <p className="mt-4 text-muted-foreground leading-relaxed">
          Email{" "}
          <TextLink href={`mailto:${OPERATOR.email}`}>
            {OPERATOR.email}
          </TextLink>
          . Questions about the app can also go to the{" "}
          <TextLink href={`${REPO}/issues`}>issue tracker</TextLink>.
        </p>
      </section>
    </LegalPage>
  );
}
