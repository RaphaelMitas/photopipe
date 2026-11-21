import { cn } from "@photopipe/ui/lib/utils";

export function TextLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className={cn(
        "text-foreground underline decoration-foreground/40 underline-offset-4 transition-colors hover:decoration-primary",
        className,
      )}
    >
      {children}
    </a>
  );
}
