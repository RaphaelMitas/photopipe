import { CloseSection } from "@/components/CloseSection";
import { DevelopSection } from "@/components/DevelopSection";
import { FaqSection } from "@/components/FaqSection";
import { FeatureGrid } from "@/components/FeatureGrid";
import { Hero } from "@/components/Hero";
import { InstinctSection } from "@/components/InstinctSection";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteNav } from "@/components/SiteNav";
import { StructuredData } from "@/components/StructuredData";
import { downloadUrl, latestVersion } from "@/lib/release";

export default async function Home() {
  const version = await latestVersion();
  const href = downloadUrl(version);

  return (
    <>
      <StructuredData version={version} href={href} />
      <SiteNav />
      <main>
        <Hero href={href} />
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
          <FaqSection />
        </div>
      </main>
      <CloseSection href={href} version={version} />
      <SiteFooter />
    </>
  );
}
