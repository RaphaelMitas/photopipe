import { Button } from "@photopipe/ui/components/button";
import { Photopipe } from "@photopipe/ui/components/photopipe-mark";
import { PhotopipeWordmark } from "@photopipe/ui/components/photopipe-wordmark";
import { APP_STORE, REPO } from "@/lib/release";

export function SiteNav({ faqHref = "/#faq" }: { faqHref?: string }) {
  const links = [
    { label: "Develop", href: "/#develop" },
    { label: "Instinct", href: "/#instinct" },
    { label: "Export", href: "/#everything-else" },
    { label: "FAQ", href: faqHref },
    { label: "GitHub", href: REPO },
  ];

  return (
    <header className="sticky top-0 z-50 border-border/60 border-b bg-background/80 backdrop-blur-xl">
      <nav className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-6">
        <a
          href="/"
          aria-label="Photopipe home"
          className="flex items-center gap-3 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
        >
          <Photopipe aria-hidden className="size-7 text-foreground" />
          <PhotopipeWordmark className="font-heading font-semibold text-lg" />
        </a>
        <div className="flex-1" />
        <div className="hidden items-center gap-1 md:flex">
          {links.map((link) => (
            <Button key={link.label} asChild variant="ghost" size="sm">
              <a href={link.href}>{link.label}</a>
            </Button>
          ))}
        </div>
        <Button asChild size="sm" className="ml-1">
          <a href={APP_STORE} data-event="Download" data-event-via="app-store">
            Download
          </a>
        </Button>
      </nav>
    </header>
  );
}
