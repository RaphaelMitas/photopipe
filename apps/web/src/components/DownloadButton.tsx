import { Button } from "@photopipe/ui/components/button";
import { Download } from "lucide-react";

type Props = {
  href: string;
  size?: React.ComponentProps<typeof Button>["size"];
  variant?: React.ComponentProps<typeof Button>["variant"];
  children: React.ReactNode;
};

export function DownloadButton({
  href,
  size = "lg",
  variant = "default",
  children,
}: Props) {
  return (
    <Button asChild size={size} variant={variant}>
      <a href={href}>
        <Download data-icon="inline-start" />
        {children}
      </a>
    </Button>
  );
}
