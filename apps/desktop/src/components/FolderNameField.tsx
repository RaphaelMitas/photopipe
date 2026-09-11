import { Button } from "@photopipe/ui/components/button";
import { Switch } from "@photopipe/ui/components/switch";
import { useState } from "react";
import { dateInFolderDefault } from "@/lib/projectFolder";

type Props = {
  folder: string;
  dateInFolder: boolean;
  onDateInFolderChange: (on: boolean) => void;
};

export function FolderNameField({
  folder,
  dateInFolder,
  onDateInFolderChange,
}: Props) {
  const fallback = dateInFolderDefault.use();
  const [touched, setTouched] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const asksToRemember = touched && !dismissed && dateInFolder !== fallback;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
            Folder
          </div>
          <div
            data-testid="folder-preview"
            className="truncate font-mono text-xs"
          >
            {folder || "name"}
          </div>
        </div>
        <label
          htmlFor="date-in-folder"
          className="text-muted-foreground text-xs"
        >
          Date in name
        </label>
        <Switch
          id="date-in-folder"
          data-testid="date-in-folder"
          size="sm"
          checked={dateInFolder}
          onCheckedChange={(on) => {
            setTouched(true);
            onDateInFolderChange(on);
          }}
        />
      </div>
      {asksToRemember && (
        <div
          data-testid="remember-default"
          className="flex items-center gap-2 rounded-lg border border-border bg-foreground/[0.03] px-3 py-2 text-muted-foreground text-xs"
        >
          <span className="flex-1">
            {dateInFolder
              ? "Put the date in folder names for future projects?"
              : "Keep the date out of folder names for future projects?"}
          </span>
          <Button
            variant="outline"
            size="sm"
            data-testid="remember-default-yes"
            className="h-6 text-xs"
            onClick={() => dateInFolderDefault.set(dateInFolder)}
          >
            Remember
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs"
            onClick={() => setDismissed(true)}
          >
            Not now
          </Button>
        </div>
      )}
    </div>
  );
}
