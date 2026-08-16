import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  autoScore: boolean;
  onAutoScore: (on: boolean) => void;
  /// Absent in the App Store build, which has no updater to check with.
  onCheckUpdates?: () => void;
};

export function SettingsDialog({
  open,
  onOpenChange,
  autoScore,
  onAutoScore,
  onCheckUpdates,
}: Props) {
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
      </DialogContent>
    </Dialog>
  );
}
