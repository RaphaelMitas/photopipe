import { FolderOpen, Images, Star } from "lucide-react";
import type { Shoot } from "@/lib/core";
import { StageCounts } from "./Dashboard";
import { Photopipe } from "./Photopipe";
import { Button } from "./ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "./ui/sidebar";

type Props = {
  shoots: Shoot[] | undefined;
  openShoot: string | null;
  onOpenShoot: (name: string) => void;
  minRating: number;
  onMinRating: (rating: number) => void;
  /// Filter only applies inside a shoot.
  filterEnabled: boolean;
  rootPath: string;
  onChangeRoot: () => void;
};

/// Primary navigation: the shoot list lives here (replacing the old
/// dashboard-as-home), plus the rating filter and the root switcher.
/// Collapses to an icon rail (⌘B). Phase 4's import/denoise entries slot
/// into the footer.
export function AppSidebar({
  shoots,
  openShoot,
  onOpenShoot,
  minRating,
  onMinRating,
  filterEnabled,
  rootPath,
  onChangeRoot,
}: Props) {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1">
          <Photopipe className="h-6 w-6 shrink-0" />
          <span className="font-heading font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
            Photopipe
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Shoots</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {(shoots ?? []).map((shoot) => (
                <SidebarMenuItem key={shoot.name}>
                  <SidebarMenuButton
                    data-testid={`shoot-${shoot.name}`}
                    isActive={openShoot === shoot.name}
                    onClick={() => onOpenShoot(shoot.name)}
                    tooltip={shoot.project ?? shoot.name}
                    className="h-auto"
                  >
                    <Images className="shrink-0" />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5 group-data-[collapsible=icon]:hidden">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate font-medium">
                          {shoot.project ?? shoot.name}
                        </span>
                        {shoot.day && (
                          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                            {shoot.day}
                          </span>
                        )}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {shoot.imageCount} photos
                      </span>
                      <StageCounts counts={shoot.counts} />
                    </span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel>Rating filter</SidebarGroupLabel>
          <SidebarGroupContent className="flex items-center gap-1 px-2 py-1">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                data-testid={`filter-${star}`}
                disabled={!filterEnabled}
                onClick={() => onMinRating(minRating === star ? 0 : star)}
                className="rounded p-0.5 transition-colors hover:text-amber-300 disabled:opacity-30"
              >
                <Star
                  className={`size-4 ${
                    filterEnabled && minRating >= star
                      ? "fill-amber-400 text-amber-400"
                      : "text-muted-foreground/50"
                  }`}
                />
              </button>
            ))}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="group-data-[collapsible=icon]:hidden">
        <div className="flex items-center gap-1 px-2 py-1">
          <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">
            {rootPath}
          </span>
          <Button
            variant="ghost"
            size="icon"
            data-testid="change-root"
            onClick={onChangeRoot}
            title="Change photos folder"
            className="size-7 text-muted-foreground"
          >
            <FolderOpen />
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
