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

// the card inverts, so the dots take whichever text color they land on
function MeterDots({ filled }: { filled: number }) {
  return (
    <span className="ml-auto flex gap-1">
      {[1, 2, 3].map((dot) => (
        <span
          key={dot}
          className={cn(
            "size-[7px] rounded-full",
            dot <= filled ? "bg-current" : "bg-current/25",
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

function DecoderCards() {
  const active = useRawDecoderVersion();
  return (
    <div className="flex gap-2">
      {DECODERS.map(({ version, body, detail, speed }) => {
        const selected = version === active;
        return (
          <button
            key={version}
            type="button"
            aria-pressed={selected}
            data-testid={`decoder-${version}`}
            onClick={() => setRawDecoderVersion(version)}
            className={cn(
              "flex flex-1 flex-col gap-2 rounded-lg border p-3 text-left",
              selected
                ? "border-foreground bg-foreground text-background"
                : "border-input hover:bg-muted",
            )}
          >
            <span className="flex items-center gap-2.5">
              <span
                className={cn(
                  "flex size-4 items-center justify-center rounded-full border-[1.5px]",
                  selected ? "border-background" : "border-input",
                )}
              >
                {selected && (
                  <span className="size-2 rounded-full bg-background" />
                )}
              </span>
              <span className="font-medium text-sm">RAW {version}</span>
            </span>
            <span
              className={cn(
                "text-xs",
                selected ? "text-background/70" : "text-muted-foreground",
              )}
            >
              {body}
            </span>
            <span
              className={cn(
                "flex flex-col gap-1 text-xs",
                selected ? "text-background/70" : "text-muted-foreground",
              )}
            >
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
          <DecoderCards />
          <p className="text-muted-foreground/75 text-xs">
            Cameras that don't support RAW 9 always use the best decoder they
            offer.
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
