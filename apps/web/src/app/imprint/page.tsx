import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";
import { OperatorAddress } from "@/components/OperatorAddress";
import { TextLink } from "@/components/TextLink";
import { OPERATOR } from "@/lib/operator";

const description = "Impressum: Angaben gemäß § 5 DDG für photopipe.net.";

export const metadata: Metadata = {
  title: "Imprint",
  description,
  alternates: { canonical: "/imprint" },
  openGraph: {
    title: "Imprint — Photopipe",
    description,
    url: "/imprint",
    images: ["/og-dark.png"],
  },
};

export default function Imprint() {
  return (
    <LegalPage title="Impressum" lang="de">
      <section className="mt-12">
        <h2 className="font-heading text-2xl tracking-tight">
          Angaben gemäß § 5 DDG
        </h2>
        <OperatorAddress />
        <p className="mt-4 text-muted-foreground leading-relaxed">
          Kontakt:
          <span className="block">
            Telefon{" "}
            <TextLink href={`tel:${OPERATOR.phone.replaceAll(" ", "")}`}>
              {OPERATOR.phone}
            </TextLink>
          </span>
          <span className="block">
            E-Mail{" "}
            <TextLink href={`mailto:${OPERATOR.email}`}>
              {OPERATOR.email}
            </TextLink>
          </span>
        </p>
      </section>
      <section className="mt-12">
        <h2 className="font-heading text-2xl tracking-tight">
          Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV
        </h2>
        <p className="mt-4 text-muted-foreground leading-relaxed">
          {OPERATOR.name}, Anschrift wie oben.
        </p>
      </section>
    </LegalPage>
  );
}
