import { Button } from "@photopipe/ui/components/button";
import { Photopipe } from "@photopipe/ui/components/photopipe-mark";
import { PhotopipeWordmark } from "@photopipe/ui/components/photopipe-wordmark";
import { INTENT_PAGES } from "@/lib/intent-pages";
import { APP_STORE, REPO } from "@/lib/release";

const LINKS = [
  { label: "GitHub", href: REPO },
  { label: "Releases", href: `${REPO}/releases` },
  { label: "App Store", href: APP_STORE, via: "app-store" },
  { label: "Design notes", href: `${REPO}/blob/main/docs/design.md` },
  { label: "Licence", href: `${REPO}/blob/main/LICENSE` },
  { label: "Privacy", href: "/privacy" },
  { label: "Imprint", href: "/imprint" },
  { label: "llms.txt", href: "/llms.txt" },
];

export function SiteFooter() {
  return (
    <footer className="border-border/60 border-t">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-4 px-6 py-10 sm:flex-row">
        <Photopipe aria-hidden className="size-5 text-muted-foreground" />
        <PhotopipeWordmark className="text-sm" />
        <div className="flex-1" />
        <div className="flex flex-wrap items-center justify-center gap-1">
          {LINKS.map((link) => (
            <Button key={link.label} asChild variant="ghost" size="sm">
              <a
                href={link.href}
                data-event={link.via ? "Download" : undefined}
                data-event-via={link.via}
              >
                {link.label}
              </a>
            </Button>
          ))}
        </div>
      </div>
      <nav
        aria-label="Comparisons"
        className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-center gap-x-6 gap-y-2 px-6 pb-10 text-muted-foreground text-sm sm:justify-start"
      >
        <span className="w-full text-center font-medium text-xs uppercase tracking-[0.14em] sm:w-auto sm:text-left">
          Compare
        </span>
        {INTENT_PAGES.map((page) => (
          <a
            key={page.slug}
            href={`/${page.slug}`}
            className="hover:text-foreground"
          >
            {page.title}
          </a>
        ))}
      </nav>
    </footer>
  );
}
