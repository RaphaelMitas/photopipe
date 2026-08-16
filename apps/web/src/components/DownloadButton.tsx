import { Button } from "@photopipe/ui/components/button";
import { Download } from "lucide-react";

type Props = {
  href: string;
  size?: React.ComponentProps<typeof Button>["size"];
  children: React.ReactNode;
};

export function DownloadButton({ href, size = "lg", children }: Props) {
  return (
    <Button asChild size={size}>
      <a href={href}>
        <Download data-icon="inline-start" />
        {children}
      </a>
    </Button>
  );
}
