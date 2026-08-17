import { Photopipe } from "@photopipe/ui/components/photopipe-mark";
import { Segmented } from "@photopipe/ui/components/segmented";
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
  SidebarSeparator,
  SidebarTrigger,
} from "@photopipe/ui/components/sidebar";
import { ChevronLeft } from "lucide-react";
import type { ImageFile } from "@/lib/core";
import { instinctScore } from "@/lib/instinct";
import type { FilmstripMode } from "./Filmstrip";
import {
  RatingFilterOps,
  RatingHistogram,
  type RatingOp,
} from "./RatingFilter";
import { Stars } from "./Stars";

type Props = {
  image: ImageFile;
  position: number;
  count: number;
  betterThan: number | null;
  filmstrip: FilmstripMode;
  onFilmstrip: (mode: FilmstripMode) => void;
  ratingCounts: number[];
  ratingOp: RatingOp;
  onRatingOp: (op: RatingOp) => void;
  ratingStars: number;
  onRatingStars: (stars: number) => void;
  onRate: (path: string, rating: number) => void;
  onBackToGrid: () => void;
};

export function LoupeSidebar({
  image,
  position,
  count,
  betterThan,
  filmstrip,
  onFilmstrip,
  ratingCounts,
  ratingOp,
  onRatingOp,
  ratingStars,
  onRatingStars,
  onRate,
  onBackToGrid,
}: Props) {
  const instinct = image.score == null ? null : instinctScore(image.score);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1">
          <Photopipe className="h-6 w-6 shrink-0" />
          <span className="font-heading font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
            Photopipe
          </span>
          <SidebarTrigger className="ml-auto text-muted-foreground" />
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  data-testid="back-to-grid"
                  onClick={onBackToGrid}
                  tooltip="Back to grid (esc)"
                >
                  <ChevronLeft className="shrink-0" />
                  <span className="group-data-[collapsible=icon]:hidden">
                    Back to grid
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel className="justify-between">
            Rating
            <RatingFilterOps op={ratingOp} onOp={onRatingOp} />
          </SidebarGroupLabel>
          <SidebarGroupContent className="px-2 py-1">
            <RatingHistogram
              counts={ratingCounts}
              op={ratingOp}
              stars={ratingStars}
              onOp={onRatingOp}
              onStars={onRatingStars}
            />
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator className="group-data-[collapsible=icon]:hidden" />

        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel>Photo</SidebarGroupLabel>
          <SidebarGroupContent className="flex flex-col gap-1 px-2 py-1">
            <span
              data-testid="loupe-name"
              className="truncate font-mono text-sm"
              title={image.rel}
            >
              {image.rel}
            </span>
            <span
              data-testid="loupe-position"
              className="font-mono text-xs text-muted-foreground"
            >
              {position}/{count}
            </span>
            <Stars
              value={image.rating}
              onRate={(rating) => onRate(image.path, rating)}
              className="mt-1 text-base"
            />
            {instinct !== null && (
              <div className="mt-2 flex flex-col gap-1" data-testid="instinct">
                <div className="flex justify-between font-mono text-xs">
                  <span className="text-muted-foreground">Instinct</span>
                  <span>{instinct}</span>
                </div>
                <div className="h-1 rounded-sm bg-foreground/10">
                  <div
                    className="h-full rounded-sm bg-primary"
                    style={{ width: `${instinct}%` }}
                  />
                </div>
                {betterThan !== null && (
                  <span className="font-mono text-[10px] text-muted-foreground">
                    higher than {betterThan}% of this project
                  </span>
                )}
              </div>
            )}
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel>View</SidebarGroupLabel>
          <SidebarGroupContent className="px-2 py-1">
            <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
              <span>Filmstrip</span>
              <Segmented
                value={filmstrip}
                options={[
                  ["off", "Off"],
                  ["thumbs", "Thumbs"],
                  ["ratings", "Ratings"],
                ]}
                testid="filmstrip"
                onChange={onFilmstrip}
              />
            </div>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="group-data-[collapsible=icon]:hidden">
        <p className="px-2 py-1 text-[10px] text-muted-foreground">
          ←→ navigate · 1–5 rate · 0 clear · ↑↓ exposure · pinch or double-click
          zoom · r reset · e edit · ⌘C/⌘V settings · esc
        </p>
      </SidebarFooter>
    </Sidebar>
  );
}
