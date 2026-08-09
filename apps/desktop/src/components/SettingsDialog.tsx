import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { AppWindow, X } from "lucide-react";
import {
  appName,
  NO_PROCESSING,
  type Settings,
  useSettings,
} from "@/lib/settings";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

async function chooseApp(): Promise<string | null> {
  const chosen = await openDialog({
    title: "Choose an application",
    directory: false,
    filters: [{ name: "Applications", extensions: ["app"] }],
    defaultPath: "/Applications",
  }).catch(() => null);
  return typeof chosen === "string" ? chosen : null;
}

function AppRow({
  id,
  path,
  onPick,
  onClear,
}: {
  id: string;
  path: string | null;
  onPick: () => void;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Button
        variant="outline"
        size="sm"
        data-testid={id}
        onClick={onPick}
        className="min-w-0 flex-1 justify-start text-xs"
      >
        <AppWindow />
        <span className="truncate">{appName(path) ?? "Choose an app"}</span>
      </Button>
      {path && (
        <Button
          variant="ghost"
          size="icon"
          title="Clear"
          onClick={onClear}
          className="size-7 shrink-0 text-muted-foreground"
        >
          <X />
        </Button>
      )}
    </div>
  );
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/// App-wide tool choices. These are machine settings, so they apply to every
/// project and never travel with a shoot's folder.
export function SettingsDialog({ open: isOpen, onOpenChange }: Props) {
  const { settings, save } = useSettings();
  const patch = (next: Partial<Settings>) => save({ ...settings, ...next });

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading">Settings</DialogTitle>
          <DialogDescription>
            The tools your hand-offs use, for every project.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="processing-mode">Processing</Label>
            <Select
              value={settings.processing ? "app" : NO_PROCESSING}
              onValueChange={async (value) => {
                if (value === NO_PROCESSING) {
                  patch({ processing: false });
                  return;
                }
                patch({ processing: true });
                if (!settings.processor) {
                  const picked = await chooseApp();
                  if (picked) patch({ processing: true, processor: picked });
                }
              }}
            >
              <SelectTrigger
                id="processing-mode"
                data-testid="processing-mode"
                className="w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PROCESSING}>
                  No processing step
                </SelectItem>
                <SelectItem value="app">
                  {appName(settings.processor) ?? "Denoise with an app"}
                </SelectItem>
              </SelectContent>
            </Select>
            {!settings.processing ? (
              <p className="text-[10px] text-muted-foreground">
                Media hands straight to your editor, and Edit works from the
                originals.
              </p>
            ) : (
              <AppRow
                id="processor-app"
                path={settings.processor}
                onPick={async () => {
                  const picked = await chooseApp();
                  if (picked) patch({ processor: picked });
                }}
                onClear={() => patch({ processor: null })}
              />
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Editor</Label>
            <AppRow
              id="editor-app"
              path={settings.editor}
              onPick={async () => {
                const picked = await chooseApp();
                if (picked) patch({ editor: picked });
              }}
              onClear={() => patch({ editor: null })}
            />
            <p className="text-[10px] text-muted-foreground">
              Where selected photos open. Finished exports land back in the
              project.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            data-testid="settings-done"
            onClick={() => onOpenChange(false)}
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
