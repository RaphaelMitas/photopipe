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
      "photopipe.net sets no cookies and stores nothing in your browser. The fonts and scripts ship with the site, so loading a page sends no request to anyone else.",
      "The site runs on a server of Hetzner Online GmbH, Industriestr. 25, 91710 Gunzenhausen, Germany, in a data centre in Helsinki, Finland. Hetzner processes data on my behalf under Art. 28 GDPR. To deliver a page, the server processes what your browser sends with every request, in particular your IP address, the time, the address you asked for and your browser and operating system. It keeps no access log. Technical error logs can occasionally contain an IP address; they are limited in size and overwritten continuously. The legal basis is Art. 6(1)(f) GDPR, my legitimate interest in delivering the site securely and reliably.",
      "The Download button and the App Store links lead to the Mac App Store, where Apple's privacy policy applies. The DMG download and the other links in the footer point to GitHub, where GitHub's privacy statement applies.",
    ],
  },
  {
    title: "Visitor counts",
    body: [
      "I count visits with Plausible, running on that same server, without cookies and without any third party. It records the page you open, the website you came from (only its domain), campaign tags in the link, your browser, operating system and country, and whether you clicked one of the download options. Your IP address and browser details are only used to work out a visitor hash, which is based on a salt that changes daily; the IP address itself is not stored.",
      "The data is deleted after 25 months. The legal basis is Art. 6(1)(f) GDPR, my legitimate interest in knowing how people find the site and whether they download the app.",
      "You can object to this at any time, without giving a reason: turn on Global Privacy Control or Do Not Track in your browser, and nothing is recorded from then on.",
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
