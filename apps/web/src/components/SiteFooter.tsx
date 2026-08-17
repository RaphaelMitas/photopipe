import { Button } from "@photopipe/ui/components/button";
import { Photopipe } from "@photopipe/ui/components/photopipe-mark";
import { PhotopipeWordmark } from "@photopipe/ui/components/photopipe-wordmark";
import { REPO } from "@/lib/release";

const LINKS = [
  { label: "GitHub", href: REPO },
  { label: "Releases", href: `${REPO}/releases` },
  { label: "Design notes", href: `${REPO}/blob/main/docs/design.md` },
  { label: "Licence", href: `${REPO}/blob/main/LICENSE` },
];

export function SiteFooter() {
  return (
    <footer className="border-border/60 border-t">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-4 px-6 py-10 sm:flex-row">
        <Photopipe aria-hidden className="size-5 text-muted-foreground" />
        <PhotopipeWordmark className="text-sm" />
        <div className="flex-1" />
        <div className="flex items-center gap-1">
          {LINKS.map((link) => (
            <Button key={link.label} asChild variant="ghost" size="sm">
              <a href={link.href}>{link.label}</a>
            </Button>
          ))}
        </div>
      </div>
    </footer>
  );
}
