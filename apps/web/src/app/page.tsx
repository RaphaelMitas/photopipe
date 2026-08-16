import { CloseSection } from "@/components/CloseSection";
import { DevelopSection } from "@/components/DevelopSection";
import { FeatureGrid } from "@/components/FeatureGrid";
import { Hero } from "@/components/Hero";
import { InstinctSection } from "@/components/InstinctSection";
import { KeyboardStrip } from "@/components/KeyboardStrip";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteNav } from "@/components/SiteNav";
import { SpecStrip } from "@/components/SpecStrip";
import { downloadUrl } from "@/lib/release";

export default async function Home() {
  const href = await downloadUrl();

  return (
    <>
      <SiteNav href={href} />
      <main>
        <Hero href={href} />
        <SpecStrip />
        <div id="develop">
          <DevelopSection />
        </div>
        <div id="instinct">
          <InstinctSection />
        </div>
        <div id="everything-else">
          <FeatureGrid />
        </div>
        <KeyboardStrip />
        <CloseSection href={href} />
      </main>
      <SiteFooter />
    </>
  );
}
