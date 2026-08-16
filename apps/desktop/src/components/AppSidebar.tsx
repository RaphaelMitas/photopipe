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
import {
  ChevronLeft,
  Download,
  FolderOpen,
  Settings,
  Settings2,
} from "lucide-react";
import type { Shoot } from "@/lib/core";
import {
  RatingFilterOps,
  RatingHistogram,
  type RatingOp,
} from "./RatingFilter";
import { SidebarBrandHeader } from "./SidebarBrandHeader";

type Props = {
  currentShoot: Shoot | undefined;
  onBack: () => void;
  onImport: () => void;
  onRevealShoot: (path: string) => void;
  onShootSettings: () => void;
  ratingCounts: number[];
  ratingOp: RatingOp;
  onRatingOp: (op: RatingOp) => void;
  ratingStars: number;
  onRatingStars: (rating: number) => void;
  filterEnabled: boolean;
  showInfo: boolean;
  onShowInfo: (show: boolean) => void;
  rootPath: string;
  onChangeRoot: () => void;
  onSettings: () => void;
};

export function AppSidebar({
  currentShoot,
  onBack,
  onImport,
  onRevealShoot,
  onShootSettings,
  ratingCounts,
  ratingOp,
  onRatingOp,
  ratingStars,
  onRatingStars,
  filterEnabled,
  showInfo,
  onShowInfo,
  rootPath,
  onChangeRoot,
  onSettings,
}: Props) {
  return (
    <Sidebar>
      <SidebarBrandHeader />
      <SidebarContent>
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
        {currentShoot && (
          <SidebarGroup>
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
              {currentShoot.notes && (
                <p className="mt-1 text-muted-foreground/70 text-xs">
                  {currentShoot.notes}
                </p>
              )}
              <div className="mt-2 flex flex-col gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  data-testid="import-files"
                  onClick={() => onImport()}
                  className="w-full text-xs"
                >
                  <Download />
                  Import photos
                </Button>
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    data-testid="shoot-settings"
                    title="Project settings"
                    onClick={() => onShootSettings()}
                    className="min-w-0 flex-1 text-xs"
                  >
                    <Settings2 />
                    Settings
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    data-testid="reveal-shoot"
                    title="Reveal project folder in Finder"
                    onClick={() => onRevealShoot(currentShoot.path)}
                    className="min-w-0 flex-1 text-xs"
                  >
                    <FolderOpen />
                    Reveal
                  </Button>
                </div>
              </div>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
        <SidebarGroup>
          <SidebarGroupLabel className="justify-between">
            Rating
            <RatingFilterOps
              op={ratingOp}
              disabled={!filterEnabled}
              onOp={onRatingOp}
            />
          </SidebarGroupLabel>
          <SidebarGroupContent className="px-2 py-1">
            <RatingHistogram
              counts={ratingCounts}
              op={ratingOp}
              stars={ratingStars}
              disabled={!filterEnabled}
              onOp={onRatingOp}
              onStars={onRatingStars}
            />
            {currentShoot && !currentShoot.indexed && (
              <p
                data-testid="ratings-indexing"
                className="mt-1 text-[10px] text-muted-foreground/70"
              >
                Still reading ratings — counts will move.
              </p>
            )}
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
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
      <SidebarFooter>
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
          <Button
            variant="ghost"
            size="icon"
            data-testid="open-settings"
            onClick={onSettings}
            title="Settings (⌘,)"
            className="size-7 text-muted-foreground"
          >
            <Settings />
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
