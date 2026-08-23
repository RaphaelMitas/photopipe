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
import { useRaw9Availability } from "@/lib/queries";
import {
  type RawDecoderVersion,
  setRawDecoderQuickSwitch,
  setRawDecoderVersion,
  useRawDecoderQuickSwitch,
  useRawDecoderVersion,
} from "@/lib/rawDecoder";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  autoScore: boolean;
  onAutoScore: (on: boolean) => void;
  onCheckUpdates: () => void;
};

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
            onClick={() => setRawDecoderVersion(version)}
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

export function SettingsDialog({
  open,
  onOpenChange,
  autoScore,
  onAutoScore,
  onCheckUpdates,
}: Props) {
  const quickSwitch = useRawDecoderQuickSwitch();
  const raw9Missing = useRaw9Availability(open).data === false;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            These stay on this Mac and apply to every project.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-start justify-between gap-6">
          <div className="flex flex-col gap-1">
            <Label htmlFor="auto-score">Rate photos with Instinct</Label>
            <p className="text-muted-foreground text-xs">
              Scores every photo in a project when you open it, so you can sort
              the likely keepers to the front. Runs on this Mac and takes about
              a minute per two thousand photos.
            </p>
          </div>
          <Switch
            id="auto-score"
            data-testid="auto-score"
            checked={autoScore}
            onCheckedChange={onAutoScore}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label>RAW decoder</Label>
          <DecoderCards raw9Missing={raw9Missing} />
          <p className="text-muted-foreground/75 text-xs">
            {raw9Missing
              ? "RAW 9 isn't available for this library on this Mac. Your choice is kept for when it is."
              : "Cameras that don't support RAW 9 always use the best decoder they offer."}
          </p>
        </div>
        <div className="flex items-start justify-between gap-6">
          <div className="flex flex-col gap-1">
            <Label htmlFor="decoder-quick-switch">
              Quick switch in the editor
            </Label>
            <p className="text-muted-foreground text-xs">
              Adds a RAW 8/9 control to the editor so you can flip decoders
              without opening Settings. It changes every photo, same as the
              buttons above.
            </p>
          </div>
          <Switch
            id="decoder-quick-switch"
            data-testid="decoder-quick-switch"
            checked={quickSwitch}
            onCheckedChange={setRawDecoderQuickSwitch}
          />
        </div>
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
      </DialogContent>
    </Dialog>
  );
}
