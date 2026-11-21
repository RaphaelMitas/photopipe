import { AppStoreBadge } from "@/components/AppStoreBadge";
import { BrewCommand } from "@/components/BrewCommand";
import { DownloadButton } from "@/components/DownloadButton";

export function InstallOptions({
  href,
  brew = true,
}: {
  href: string;
  brew?: boolean;
}) {
  return (
    <div className="mt-9 flex flex-col flex-wrap items-center justify-center gap-3 sm:flex-row">
      <AppStoreBadge />
      <DownloadButton href={href} variant="outline">
        Download DMG
      </DownloadButton>
      {brew ? <BrewCommand /> : null}
    </div>
  );
}
