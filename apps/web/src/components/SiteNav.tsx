import { Button } from "@photopipe/ui/components/button";
import { Logo } from "@/components/Logo";

const LINKS = [
  { label: "Develop", href: "#develop" },
  { label: "Instinct", href: "#instinct" },
  { label: "Export", href: "#everything-else" },
  { label: "GitHub", href: "https://github.com/RaphaelMitas/photopipe" },
];

export function SiteNav({ href }: { href: string }) {
  return (
    <header className="sticky top-0 z-50 border-border/60 border-b bg-background/80 backdrop-blur-xl">
      <nav className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-6">
        <Logo className="size-7 text-foreground" />
        <span className="font-heading font-semibold text-lg">Photopipe</span>
        <div className="flex-1" />
        <div className="hidden items-center gap-1 md:flex">
          {LINKS.map((link) => (
            <Button key={link.label} asChild variant="ghost" size="sm">
              <a href={link.href}>{link.label}</a>
            </Button>
          ))}
        </div>
        <Button asChild size="sm" className="ml-1">
          <a href={href}>Download</a>
        </Button>
      </nav>
    </header>
  );
}
