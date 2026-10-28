import { Button } from "@photopipe/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@photopipe/ui/components/dialog";
import { Label } from "@photopipe/ui/components/label";
import { Switch } from "@photopipe/ui/components/switch";
import { cn } from "@photopipe/ui/lib/utils";
import type { ReactNode } from "react";
import { flagPref } from "@/lib/pref";
import { useRaw9Availability } from "@/lib/queries";
import {
  type RawDecoderVersion,
  setRawDecoderQuickSwitch,
  setRawDecoderVersion,
  useRawDecoderQuickSwitch,
  useRawDecoderVersion,
} from "@/lib/rawDecoder";
import { KeyboardSettings } from "./KeyboardSettings";
import { tooltipsPref } from "./ShortcutTooltip";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  onCheckUpdates?: () => void;
};

export const autoScorePref = flagPref("photopipe.autoScore", "on", "off", true);

function MeterDots({ filled }: { filled: number }) {
  return (
    <span className="ml-auto flex gap-1">
      {[1, 2, 3].map((dot) => (
        <span
          key={dot}
          className={cn(
            "size-[7px] rounded-full",
            dot <= filled ? "bg-primary" : "bg-input",
          )}
        />
      ))}
    </span>
  );
}

const DECODERS: {
  version: RawDecoderVersion;
  body: string;
  detail: number;
  speed: number;
}[] = [
  {
    version: 9,
    body: "Apple's newest pipeline, best for editing and export.",
    detail: 3,
    speed: 1,
  },
  {
    version: 8,
    body: "Noticeably faster, good for culling big shoots.",
    detail: 2,
    speed: 3,
  },
];

function DecoderCards({ raw9Missing }: { raw9Missing: boolean }) {
  const stored = useRawDecoderVersion();
  // the preference survives so it lights up on a Mac that has RAW 9; only
  // what the cards claim is happening changes
  const active = raw9Missing ? 8 : stored;
  return (
    <div className="flex gap-2">
      {DECODERS.map(({ version, body, detail, speed }) => {
        const selected = version === active;
        const unavailable = raw9Missing && version === 9;
        return (
          <button
            key={version}
            type="button"
            aria-pressed={selected}
            disabled={unavailable}
            data-testid={`decoder-${version}`}
            onClick={() => {
              // shown as selected while stored says 9: writing here would
              // destroy a preference the disabled card cannot restore
              if (version !== active) setRawDecoderVersion(version);
            }}
            className={cn(
              "flex flex-1 flex-col gap-2 rounded-lg border p-3 text-left",
              unavailable && "opacity-50",
              selected
                ? "border-primary bg-primary/10"
                : "border-input hover:bg-accent/50",
            )}
          >
            <span className="flex items-center gap-2.5">
              <span
                className={cn(
                  "flex size-4 items-center justify-center rounded-full border-[1.5px]",
                  selected ? "border-primary" : "border-input",
                )}
              >
                {selected && (
                  <span className="size-2 rounded-full bg-primary" />
                )}
              </span>
              <span className="font-medium text-sm">RAW {version}</span>
            </span>
            <span className="text-muted-foreground text-xs">{body}</span>
            <span className="flex flex-col gap-1 text-muted-foreground text-xs">
              <span className="flex items-center">
                Detail &amp; denoise <MeterDots filled={detail} />
              </span>
              <span className="flex items-center">
                Decode speed <MeterDots filled={speed} />
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function SettingSwitch({
  id,
  label,
  checked,
  onCheckedChange,
  children,
}: {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="flex flex-col gap-1">
        <Label htmlFor={id}>{label}</Label>
        <p className="text-muted-foreground text-xs">{children}</p>
      </div>
      <Switch
        id={id}
        data-testid={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}

export type SettingsSection = "general" | "raw" | "keyboard";

const SECTIONS: readonly [SettingsSection, string][] = [
  ["general", "General"],
  ["raw", "RAW decoding"],
  ["keyboard", "Keyboard"],
];

export function SettingsDialog({
  open,
  onOpenChange,
  section,
  onSectionChange,
  onCheckUpdates,
}: Props) {
  const autoScore = autoScorePref.use();
  const quickSwitch = useRawDecoderQuickSwitch();
  const tooltips = tooltipsPref.use();
  const raw9Missing = useRaw9Availability(open).data === false;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[min(36rem,calc(100vh-4rem))] gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <div className="flex min-h-0">
          <nav className="flex w-44 shrink-0 flex-col gap-0.5 border-border border-r bg-sidebar p-3 pt-14">
            {SECTIONS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                data-testid={`settings-${value}`}
                aria-current={section === value ? "page" : undefined}
                onClick={() => onSectionChange(value)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent/50",
                  section === value && "bg-accent text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-6 overflow-y-auto p-6">
            <DialogHeader>
              <DialogTitle>
                {SECTIONS.find(([value]) => value === section)?.[1]}
              </DialogTitle>
              <DialogDescription>
                {section === "keyboard"
                  ? "A key can mean something else in the grid, the loupe and while cropping."
                  : "These stay on this Mac and apply to every project."}
              </DialogDescription>
            </DialogHeader>
            {section === "general" && (
              <>
                <SettingSwitch
                  id="auto-score"
                  label="Rate photos with Instinct"
                  checked={autoScore}
                  onCheckedChange={autoScorePref.set}
                >
                  Scores every photo in a project when you open it, so you can
                  sort the likely keepers to the front. Runs on this Mac and
                  takes about a minute per two thousand photos.
                </SettingSwitch>
                {onCheckUpdates && (
                  <DialogFooter className="sm:justify-start">
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid="check-updates"
                      onClick={onCheckUpdates}
                    >
                      Check for Updates
                    </Button>
                  </DialogFooter>
                )}
              </>
            )}
            {section === "raw" && (
              <>
                <div className="flex flex-col gap-2">
                  <Label>RAW decoder</Label>
                  <DecoderCards raw9Missing={raw9Missing} />
                  <p className="text-muted-foreground/75 text-xs">
                    {raw9Missing
                      ? "RAW 9 isn't available for this library. Your choice is kept for when it is."
                      : "Cameras that don't support RAW 9 always use the best decoder they offer."}
                  </p>
                </div>
                <SettingSwitch
                  id="decoder-quick-switch"
                  label="Quick switch in the editor"
                  checked={quickSwitch}
                  onCheckedChange={setRawDecoderQuickSwitch}
                >
                  Adds a RAW 8/9 control to the editor so you can flip decoders
                  without opening Settings. It changes every photo, same as the
                  buttons above.
                </SettingSwitch>
              </>
            )}
            {section === "keyboard" && (
              <>
                <SettingSwitch
                  id="shortcut-tooltips"
                  label="Show tooltips"
                  checked={tooltips}
                  onCheckedChange={tooltipsPref.set}
                >
                  Hovering a button names it and shows its key.
                </SettingSwitch>
                <KeyboardSettings />
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
