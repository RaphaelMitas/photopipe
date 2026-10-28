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
import type { ReactNode } from "react";
import type { Flag, ImageFile, PassProgress } from "@/lib/core";
import { exposureParts, takenText } from "@/lib/exif";
import { fileName } from "@/lib/fileName";
import { instinctScore } from "@/lib/instinct";
import { type ActionId, RATING_ACTIONS } from "@/lib/keymap";
import { shortcutLabel, useOverrides } from "@/lib/shortcuts";
import { sortImages } from "@/lib/sort";
import type { Stack } from "@/lib/stacks";
import { filmstripPref } from "./Filmstrip";
import { autoAdvancePref } from "./Loupe";
import {
  type RatingCounts,
  type RatingFilter,
  RatingFilterGroup,
} from "./RatingFilter";
import { ShortcutTooltip } from "./ShortcutTooltip";
import { SidebarBrandHeader } from "./SidebarBrandHeader";
import { FlagButtons, Stars } from "./Stars";

export type SidebarStacks = {
  on: boolean;
  progress: PassProgress | null;
  ready: boolean;
  onToggle: () => void;
  /// Null until stacks are ready, and for a photo that stands alone.
  current: { stack: Stack; inside: boolean } | null;
};

type Props = {
  image: ImageFile;
  position: string;
  stacks: SidebarStacks;
  betterThan: number | null;
  filter: RatingFilter;
  ratingCounts: RatingCounts;
  /// The stack's shared flag outside it, so the buttons show what a click will toggle.
  flag: Flag;
  onRate: (path: string, rating: number) => void;
  onFlag: (path: string, flag: Flag) => void;
  onBackToGrid: () => void;
};

export function LoupeSidebar({
  image,
  position,
  stacks,
  betterThan,
  filter,
  ratingCounts,
  flag,
  onRate,
  onFlag,
  onBackToGrid,
}: Props) {
  const filmstrip = filmstripPref.use();
  const autoAdvance = autoAdvancePref.use();
  const andNext = autoAdvance ? " & next" : "";
  const overrides = useOverrides();
  const hint = (text: string, ids: ActionId[], separator = "") => {
    const keys = ids.map((id) => shortcutLabel(id, overrides));
    return keys.includes(null)
      ? null
      : `${keys.join(separator)} ${text}`.trim();
  };
  const withKey = (text: string, id: ActionId) =>
    [text, shortcutLabel(id, overrides)].filter(Boolean).join(" · ");
  const stars = RATING_ACTIONS.slice(1).map((id) =>
    shortcutLabel(id, overrides),
  );
  const ratingKeys = stars.every((key, index) => key === String(index + 1))
    ? "1–5"
    : !stars.includes(null) && stars.join("/");
  const where = stacks.current;
  const inside = where?.inside ?? false;
  const hints = [
    hint(!where ? "navigate" : inside ? "frames" : "stacks", [
      "photo.previous",
      "photo.next",
    ]),
    ratingKeys &&
      `${ratingKeys} rate${!where ? "" : inside ? " this frame" : " every frame"}${andNext}`,
    inside && hint(`pick${andNext}`, ["flag.pick"]),
    where && !inside && hint("inside", ["stack.enter"]),
    hint("clear", ["rate.0"]),
    hint("exposure", ["exposure.up", "exposure.down"]),
    "pinch or double-click zoom",
    hint("reset", ["exposure.reset"]),
    hint("edit", ["editPanel.toggle"]),
    hint("before/after", ["split.toggle"]),
    hint("settings", ["settings.copy", "settings.paste"], "/"),
    hint("undo", ["history.undo"]),
    hint("stacks", ["stacks.toggle"]),
    hint("auto-advance", ["autoAdvance.toggle"]),
    hint(inside ? "up" : "", ["loupe.close"]),
  ];
  const instinct = image.score == null ? null : instinctScore(image.score);

  return (
    <Sidebar>
      <SidebarBrandHeader />
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <ShortcutTooltip label="Back to grid" action="loupe.close">
                  <SidebarMenuButton
                    data-testid="back-to-grid"
                    onClick={onBackToGrid}
                  >
                    <ChevronLeft />
                    <span>Back to grid</span>
                  </SidebarMenuButton>
                </ShortcutTooltip>
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
              {position}
            </span>
            <ShotInfo image={image} />
            <span className="mt-1 flex items-center gap-2">
              <FlagButtons
                value={flag}
                onFlag={(flag) => onFlag(image.path, flag)}
              />
              <Stars
                value={image.rating}
                onRate={(rating) => onRate(image.path, rating)}
                className="text-base"
              />
            </span>
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

        {stacks.current && <InstinctPick stack={stacks.current.stack} />}

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
              <SwitchRow
                id="stacks"
                title="Stacks"
                hint={
                  <span data-testid="stacks-status">
                    {stacks.on && !stacks.ready
                      ? `finding stacks${finding(stacks.progress)}`
                      : withKey("near-identical photos", "stacks.toggle")}
                  </span>
                }
                checked={stacks.on}
                onCheckedChange={stacks.onToggle}
              />
              <SwitchRow
                id="auto-advance"
                title="Auto-advance"
                hint={withKey("next after rating", "autoAdvance.toggle")}
                checked={autoAdvance}
                onCheckedChange={autoAdvancePref.set}
              />
            </div>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <p
          data-testid="loupe-hints"
          className="px-2 py-1 text-[10px] text-muted-foreground"
        >
          {hints.filter(Boolean).join(" · ")}
        </p>
      </SidebarFooter>
    </Sidebar>
  );
}

function SwitchRow({
  id,
  title,
  hint,
  checked,
  onCheckedChange,
}: {
  id: string;
  title: string;
  hint: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="mt-2 flex items-center justify-between gap-2">
      <Label
        htmlFor={id}
        className="flex flex-col items-start gap-0.5 font-normal text-xs"
      >
        <span className="text-foreground">{title}</span>
        <span>{hint}</span>
      </Label>
      <Switch
        id={id}
        data-testid={`${id}-toggle`}
        checked={checked}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}

const finding = (progress: PassProgress | null) =>
  progress && progress.total > 0
    ? ` · ${Math.floor((progress.done / progress.total) * 100)}%`
    : "…";

function ShotInfo({ image }: { image: ImageFile }) {
  const exposure = exposureParts(image.exif);
  const gear = [image.exif.lens, image.exif.body].filter(Boolean).join(" · ");
  return (
    <>
      {exposure.length > 0 && (
        <div
          data-testid="loupe-exposure"
          className="mt-1 flex justify-between gap-2 font-mono text-xs"
        >
          {exposure.map((part) => (
            <span key={part}>{part}</span>
          ))}
        </div>
      )}
      {gear && (
        <span
          className="truncate font-mono text-[10px] text-muted-foreground"
          title={gear}
        >
          {gear}
        </span>
      )}
      {image.captured !== null && (
        <span
          data-testid="loupe-taken"
          className="font-mono text-[10px] text-muted-foreground"
        >
          {takenText(image.captured)}
        </span>
      )}
    </>
  );
}

function InstinctPick({ stack }: { stack: Stack }) {
  const [instinct] = sortImages(stack.frames, "score");
  if (instinct.score === null) return null;
  return (
    <SidebarGroup data-testid="stack-group">
      <SidebarGroupLabel>Stack</SidebarGroupLabel>
      <SidebarGroupContent className="flex justify-between gap-2 px-2 py-1 font-mono text-xs">
        <span className="text-muted-foreground">Instinct's pick</span>
        <span className="truncate">{fileName(instinct.path)}</span>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
