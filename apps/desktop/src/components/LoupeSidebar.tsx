import { ChevronLeft, RotateCcw } from "lucide-react";
import type { ImageFile } from "@/lib/core";
import type { FilmstripMode } from "./Filmstrip";
import { EXPOSURE_RANGE } from "./Loupe";
import { Photopipe } from "./Photopipe";
import {
  RatingFilterOps,
  RatingHistogram,
  type RatingOp,
} from "./RatingFilter";
import { Stars } from "./Stars";
import { Button } from "./ui/button";
import { Segmented } from "./ui/segmented";
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
} from "./ui/sidebar";
import { Slider } from "./ui/slider";

type Props = {
  image: ImageFile;
  position: number;
  count: number;
  exposure: number;
  filmstrip: FilmstripMode;
  onFilmstrip: (mode: FilmstripMode) => void;
  ratingCounts: number[];
  ratingOp: RatingOp;
  onRatingOp: (op: RatingOp) => void;
  ratingStars: number;
  onRatingStars: (stars: number) => void;
  onExposureChange: (ev: number) => void;
  onRate: (path: string, rating: number) => void;
  onBackToGrid: () => void;
};

export function LoupeSidebar({
  image,
  position,
  count,
  exposure,
  filmstrip,
  onFilmstrip,
  ratingCounts,
  ratingOp,
  onRatingOp,
  ratingStars,
  onRatingStars,
  onExposureChange,
  onRate,
  onBackToGrid,
}: Props) {
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
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel>Edit</SidebarGroupLabel>
          <SidebarGroupContent className="flex flex-col gap-2 px-2 py-1">
            <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
              <span>Exposure</span>
              <span className="flex-1 text-right">
                {exposure >= 0 ? "+" : ""}
                {exposure.toFixed(2)}
              </span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onExposureChange(0)}
                title="Reset exposure (r)"
                className="size-6 text-muted-foreground"
              >
                <RotateCcw />
              </Button>
            </div>
            <Slider
              data-testid="exposure"
              min={-EXPOSURE_RANGE}
              max={EXPOSURE_RANGE}
              step={0.1}
              value={[exposure]}
              onValueChange={([value]) => onExposureChange(value)}
            />
            <p className="text-[10px] text-muted-foreground">
              Saved with the photo. JPEG exports apply it.
            </p>
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
          ←→ navigate · 1–5 rate · 0 clear · ↑↓ exposure · r reset · esc
        </p>
      </SidebarFooter>
    </Sidebar>
  );
}
