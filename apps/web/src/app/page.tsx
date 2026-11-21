import { CloseSection } from "@/components/CloseSection";
import { DevelopSection } from "@/components/DevelopSection";
import { FaqSection } from "@/components/FaqSection";
import { FeatureGrid } from "@/components/FeatureGrid";
import { Hero } from "@/components/Hero";
import { InstinctSection } from "@/components/InstinctSection";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteNav } from "@/components/SiteNav";
import { StructuredData } from "@/components/StructuredData";
import { FAQ } from "@/lib/faq";
import { downloadUrl, latestVersion } from "@/lib/release";
import { SITE_URL, TITLE } from "@/lib/site";

export default async function Home() {
  const version = await latestVersion();
  const href = downloadUrl(version);

  return (
    <>
      <StructuredData
        version={version}
        href={href}
        url={SITE_URL}
        title={TITLE}
        image="hero"
        faq={FAQ}
      />
      <SiteNav />
      <main>
        <Hero
          href={href}
          eyebrow="Free raw photo editor for Mac"
          title={
            <>
              From 2000 raws to the ones you&rsquo;ll{" "}
              <span className="text-primary">send</span>.
            </>
          }
          lede="Cull, develop and export your raws in one free Mac app. Tone, colour, curves, Neural Engine denoise and crop run through Apple’s raw pipeline, and on-device AI ranks the shoot before you start. No catalogue, no import, no account."
          screenshot={{
            name: "hero",
            alt: "Photopipe on a Mac: a five-star raw open in the loupe, the edit panel beside it",
          }}
        />
        <div id="develop">
          <DevelopSection />
        </div>
        <div id="instinct">
          <InstinctSection />
        </div>
        <div id="everything-else">
          <FeatureGrid />
        </div>
        <div id="faq">
          <FaqSection items={FAQ} />
        </div>
      </main>
      <CloseSection href={href} version={version} />
      <SiteFooter />
    </>
  );
}
