import { Button } from "@photopipe/ui/components/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@photopipe/ui/components/sidebar";
import { Switch } from "@photopipe/ui/components/switch";
import { ChevronLeft, FolderOpen, Settings, Settings2 } from "lucide-react";
import { dayOutsideName, type Shoot } from "@/lib/core";
import { flagPref } from "@/lib/pref";
import type { PhotoSource } from "@/lib/roots";
import { ImportButton } from "./ImportButton";
import {
  type RatingCounts,
  type RatingFilter,
  RatingFilterGroup,
} from "./RatingFilter";
import { ShortcutTooltip } from "./ShortcutTooltip";
import { SidebarBrandHeader } from "./SidebarBrandHeader";

export const showInfoPref = flagPref(
  "photopipe.gridInfo",
  "always",
  "hover",
  false,
);

type Props = {
  inShoot: boolean;
  currentShoot: Shoot | undefined;
  onBack: () => void;
  onImport: (from: PhotoSource) => void;
  onRevealShoot?: (path: string) => void;
  onShootSettings: () => void;
  filter: RatingFilter;
  ratingCounts: RatingCounts;
  rootPath: string;
  onChangeRoot: () => void;
  onSettings: () => void;
};

export function AppSidebar({
  inShoot,
  currentShoot,
  onBack,
  onImport,
  onRevealShoot,
  onShootSettings,
  filter,
  ratingCounts,
  rootPath,
  onChangeRoot,
  onSettings,
}: Props) {
  const showInfo = showInfoPref.use();
  return (
    <Sidebar>
      <SidebarBrandHeader />
      <SidebarContent>
        {inShoot && (
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    data-testid="back-to-shoots"
                    onClick={onBack}
                  >
                    <ChevronLeft />
                    <span>All shoots</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
        {currentShoot && (
          <SidebarGroup>
            <SidebarGroupLabel>Project</SidebarGroupLabel>
            <SidebarGroupContent
              data-testid="shoot-details"
              className="flex flex-col gap-1 px-2 py-1"
            >
              {dayOutsideName(currentShoot) && (
                <span className="font-mono text-2xs text-muted-foreground tabular-nums">
                  {currentShoot.day}
                </span>
              )}
              {currentShoot.notes && (
                <p className="text-muted-foreground text-xs">
                  {currentShoot.notes}
                </p>
              )}
              <div className="mt-2 flex gap-1.5">
                <ImportButton
                  variant="outline"
                  testId="import-files"
                  onImport={onImport}
                  className="min-w-0 flex-1 text-xs"
                />
                <ShortcutTooltip label="Project settings">
                  <Button
                    size="icon-sm"
                    variant="outline"
                    data-testid="shoot-settings"
                    aria-label="Project settings"
                    onClick={() => onShootSettings()}
                  >
                    <Settings2 />
                  </Button>
                </ShortcutTooltip>
                {onRevealShoot && (
                  <ShortcutTooltip label="Reveal project folder in Finder">
                    <Button
                      size="icon-sm"
                      variant="outline"
                      data-testid="reveal-shoot"
                      aria-label="Reveal project folder in Finder"
                      onClick={() => onRevealShoot(currentShoot.path)}
                    >
                      <FolderOpen />
                    </Button>
                  </ShortcutTooltip>
                )}
              </div>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
        {inShoot && (
          <>
            <RatingFilterGroup filter={filter} counts={ratingCounts}>
              {currentShoot && !currentShoot.indexed && (
                <p
                  data-testid="ratings-indexing"
                  className="mt-1 text-2xs text-muted-foreground"
                >
                  Still reading ratings, counts will move.
                </p>
              )}
            </RatingFilterGroup>
            <SidebarGroup>
              <SidebarGroupLabel>View</SidebarGroupLabel>
              <SidebarGroupContent className="px-2 py-1">
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>Always show info</span>
                  <Switch
                    data-testid="grid-info-toggle"
                    aria-label="Always show image info"
                    checked={showInfo}
                    onCheckedChange={showInfoPref.set}
                  />
                </div>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        )}
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center gap-1 px-1 py-1">
          <ShortcutTooltip label={`Change photos folder · ${rootPath}`}>
            <Button
              variant="ghost"
              size="sm"
              data-testid="change-root"
              aria-label={`Change photos folder, ${rootPath}`}
              onClick={onChangeRoot}
              className="h-7 min-w-0 flex-1 justify-start px-1.5 font-mono font-normal text-2xs text-muted-foreground"
            >
              {/* rtl truncates from the start, so the leaf folder stays visible */}
              <span dir="rtl" className="min-w-0 truncate text-left">
                <bdi>{rootPath}</bdi>
              </span>
            </Button>
          </ShortcutTooltip>
          <ShortcutTooltip label="Settings" action="app.settings">
            <Button
              variant="ghost"
              size="icon"
              data-testid="open-settings"
              aria-label="Settings"
              onClick={onSettings}
              className="size-7 text-muted-foreground"
            >
              <Settings />
            </Button>
          </ShortcutTooltip>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
