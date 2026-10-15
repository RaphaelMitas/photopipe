import { Label } from "@photopipe/ui/components/label";
import { Segmented } from "@photopipe/ui/components/segmented";
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
  SidebarSeparator,
} from "@photopipe/ui/components/sidebar";
import { Switch } from "@photopipe/ui/components/switch";
import { ChevronLeft } from "lucide-react";
import type { ImageFile, PassProgress } from "@/lib/core";
import { fileName } from "@/lib/fileName";
import { instinctScore } from "@/lib/instinct";
import { sortImages } from "@/lib/sort";
import { type Stack, stackRating } from "@/lib/stacks";
import { filmstripPref } from "./Filmstrip";
import { type RatingFilter, RatingFilterGroup } from "./RatingFilter";
import { SidebarBrandHeader } from "./SidebarBrandHeader";
import { Stars } from "./Stars";

export type SidebarStacks = {
  on: boolean;
  progress: PassProgress | null;
  ready: boolean;
  onToggle: () => void;
  /// The stack you are at, once stacks are ready and it holds more than one photo.
  current: { stack: Stack; inside: boolean } | null;
};

type Props = {
  image: ImageFile;
  /// Of the stack you are at, or of the frame when inside one.
  position: number;
  count: number;
  stacks: SidebarStacks;
  betterThan: number | null;
  filter: RatingFilter;
  ratingCounts: number[];
  onRate: (path: string, rating: number) => void;
  onBackToGrid: () => void;
};

export function LoupeSidebar({
  image,
  position,
  count,
  stacks,
  betterThan,
  filter,
  ratingCounts,
  onRate,
  onBackToGrid,
}: Props) {
  const filmstrip = filmstripPref.use();
  const instinct = image.score == null ? null : instinctScore(image.score);

  return (
    <Sidebar>
      <SidebarBrandHeader />
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  data-testid="back-to-grid"
                  onClick={onBackToGrid}
                  title="Back to grid (esc)"
                >
                  <ChevronLeft />
                  <span>Back to grid</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <RatingFilterGroup filter={filter} counts={ratingCounts} />

        <SidebarSeparator />

        <SidebarGroup>
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
              {stacks.on && stacks.ready && !stacks.current?.inside
                ? "stack "
                : ""}
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

        {stacks.current && <StackGroup {...stacks.current} />}

        <SidebarGroup>
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
                onChange={filmstripPref.set}
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <Label
                  htmlFor="stacks"
                  className="flex flex-col items-start gap-0.5 font-normal text-xs"
                >
                  <span className="text-foreground">Stacks</span>
                  <span data-testid="stacks-status">
                    {stacks.on && !stacks.ready
                      ? `finding stacks${finding(stacks.progress)}`
                      : "near-identical photos · s"}
                  </span>
                </Label>
                <Switch
                  id="stacks"
                  data-testid="stacks-toggle"
                  checked={stacks.on}
                  onCheckedChange={stacks.onToggle}
                />
              </div>
            </div>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <p className="px-2 py-1 text-[10px] text-muted-foreground">
          {!stacks.current
            ? "←→ navigate · 1–5 rate · 0 clear"
            : stacks.current.inside
              ? "←→ frames · 1–5 rate this frame · p pick · esc up"
              : "←→ stacks · 1–5 rate every frame · enter inside"}{" "}
          · ↑↓ exposure · pinch or double-click zoom · r reset · e edit · ⌘C/⌘V
          settings · ⌘Z undo{stacks.current?.inside ? "" : " · esc"}
        </p>
      </SidebarFooter>
    </Sidebar>
  );
}

const finding = (progress: PassProgress | null) =>
  progress && progress.total > 0
    ? ` · ${Math.floor((progress.done / progress.total) * 100)}%`
    : "…";

function StackGroup({ stack, inside }: { stack: Stack; inside: boolean }) {
  const rating = stackRating(stack);
  const rated = stack.frames.filter((frame) => frame.rating === rating).length;
  const [instinct] = sortImages(stack.frames, "score");
  const rows: [string, string][] = [
    ["frames", String(stack.frames.length)],
    [
      "rating",
      rating === 0
        ? "none yet"
        : rated === stack.frames.length
          ? `all ★${rating}`
          : `★${rating} on ${rated} of ${stack.frames.length}`,
    ],
  ];
  if (instinct.score !== null)
    rows.push(["Instinct's pick", fileName(instinct.path)]);
  return (
    <SidebarGroup data-testid="stack-group">
      <SidebarGroupLabel>Stack</SidebarGroupLabel>
      <SidebarGroupContent className="flex flex-col gap-1 px-2 py-1 font-mono text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-2">
            <span className="text-muted-foreground">{label}</span>
            <span className="truncate">{value}</span>
          </div>
        ))}
        <span className="mt-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
          {inside
            ? "1–5 rates this frame · p picks it"
            : `1–5 rates all ${stack.frames.length} frames`}
        </span>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
