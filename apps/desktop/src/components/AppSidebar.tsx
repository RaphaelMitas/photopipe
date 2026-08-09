import { ChevronLeft, Download, FolderOpen } from "lucide-react";
import type { Shoot } from "@/lib/core";
import { StageCounts } from "./Dashboard";
import { Photopipe } from "./Photopipe";
import {
  RatingFilterOps,
  RatingFilterStars,
  type RatingOp,
} from "./RatingFilter";
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
  SidebarTrigger,
} from "./ui/sidebar";
import { Switch } from "./ui/switch";

type Props = {
  /// The open shoot, or null at the library. The sidebar shows only the
  /// current shoot — the library page is where shoots are browsed.
  currentShoot: Shoot | undefined;
  onBack: () => void;
  /// Imports into the current page's stage folder.
  onImport: () => void;
  onRevealShoot: (path: string) => void;
  ratingOp: RatingOp;
  onRatingOp: (op: RatingOp) => void;
  ratingStars: number;
  onRatingStars: (rating: number) => void;
  /// Filter only applies inside a shoot.
  filterEnabled: boolean;
  /// Grid overlay (stem, stage, rating): always visible vs hover-only.
  showInfo: boolean;
  onShowInfo: (show: boolean) => void;
  rootPath: string;
  onChangeRoot: () => void;
};

/// Context for the open shoot: what you're in, the way back, the filters.
/// The shoot *list* deliberately lives on the library page, not here — one
/// place to browse, one place to work. Collapses to an icon rail (⌘B).
export function AppSidebar({
  currentShoot,
  onBack,
  onImport,
  onRevealShoot,
  ratingOp,
  onRatingOp,
  ratingStars,
  onRatingStars,
  filterEnabled,
  showInfo,
  onShowInfo,
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
          {/* The trigger lives here, not in the top bar: that strip is
              navigation only. The icon rail keeps it reachable when collapsed. */}
          <SidebarTrigger className="ml-auto text-muted-foreground" />
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  data-testid="back-to-shoots"
                  onClick={onBack}
                  tooltip="All shoots"
                >
                  <ChevronLeft className="shrink-0" />
                  <span className="group-data-[collapsible=icon]:hidden">
                    All shoots
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {currentShoot && (
          <SidebarGroup className="group-data-[collapsible=icon]:hidden">
            <SidebarGroupLabel>Project</SidebarGroupLabel>
            <SidebarGroupContent
              data-testid="current-shoot"
              className="flex flex-col gap-1 px-2 py-1"
            >
              <span className="truncate font-medium text-sm">
                {currentShoot.project ?? currentShoot.name}
              </span>
              {currentShoot.day && (
                <span className="font-mono text-[10px] text-muted-foreground">
                  {currentShoot.day}
                </span>
              )}
              <span className="text-[10px] text-muted-foreground">
                {currentShoot.imageCount} photos
              </span>
              <StageCounts counts={currentShoot.counts} />
              {currentShoot.notes && (
                <p className="mt-1 text-muted-foreground/70 text-xs">
                  {currentShoot.notes}
                </p>
              )}
              <div className="mt-2 flex gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  data-testid="import-files"
                  onClick={onImport}
                  className="flex-1 text-xs"
                >
                  <Download />
                  Import
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  data-testid="reveal-shoot"
                  title="Reveal project folder in Finder"
                  onClick={() => onRevealShoot(currentShoot.path)}
                  className="flex-1 text-xs"
                >
                  <FolderOpen />
                  Reveal
                </Button>
              </div>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel>Rating filter</SidebarGroupLabel>
          <SidebarGroupContent className="flex items-center gap-2 px-2 py-1">
            <RatingFilterOps
              op={ratingOp}
              disabled={!filterEnabled}
              onOp={onRatingOp}
            />
            <RatingFilterStars
              stars={ratingStars}
              disabled={!filterEnabled}
              muted={ratingOp === "unrated"}
              onStars={onRatingStars}
            />
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel>View</SidebarGroupLabel>
          <SidebarGroupContent className="px-2 py-1">
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>Always show info</span>
              <Switch
                data-testid="grid-info-toggle"
                aria-label="Always show image info"
                checked={showInfo}
                onCheckedChange={onShowInfo}
              />
            </div>
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
