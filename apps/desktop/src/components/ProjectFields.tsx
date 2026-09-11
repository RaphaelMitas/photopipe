import { Button } from "@photopipe/ui/components/button";
import { Input } from "@photopipe/ui/components/input";
import { Label } from "@photopipe/ui/components/label";
import { Switch } from "@photopipe/ui/components/switch";
import { Textarea } from "@photopipe/ui/components/textarea";
import { useState } from "react";
import { dateInFolderDefault, projectFolder } from "@/lib/projectFolder";

export type ProjectDraft = {
  name: string;
  day: string;
  dateInFolder: boolean;
  notes: string;
};

export function projectRequest(draft: ProjectDraft) {
  return { ...draft, day: draft.day || null };
}

export function ProjectFields({
  draft,
  onChange,
}: {
  draft: ProjectDraft;
  onChange: (draft: ProjectDraft) => void;
}) {
  const set = (patch: Partial<ProjectDraft>) =>
    onChange({ ...draft, ...patch });
  return (
    <>
      <div className="flex gap-3">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="project-name">Project</Label>
          <Input
            id="project-name"
            data-testid="project-name"
            value={draft.name}
            autoFocus
            placeholder="zell"
            onChange={(event) => set({ name: event.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="project-day">Date</Label>
          <Input
            id="project-day"
            data-testid="project-day"
            type="date"
            value={draft.day}
            onChange={(event) => set({ day: event.target.value })}
          />
        </div>
      </div>

      <FolderNameField
        folder={projectFolder(draft.name, draft.day, draft.dateInFolder)}
        dateInFolder={draft.dateInFolder}
        disabled={!draft.day}
        onDateInFolderChange={(dateInFolder) => set({ dateInFolder })}
      />

      <div className="space-y-1.5">
        <Label htmlFor="project-notes">Notes</Label>
        <Textarea
          id="project-notes"
          data-testid="project-notes"
          value={draft.notes}
          rows={3}
          placeholder="Anything worth remembering about this shoot."
          onChange={(event) => set({ notes: event.target.value })}
        />
      </div>
    </>
  );
}

function FolderNameField({
  folder,
  dateInFolder,
  disabled,
  onDateInFolderChange,
}: {
  folder: string;
  dateInFolder: boolean;
  disabled: boolean;
  onDateInFolderChange: (on: boolean) => void;
}) {
  const fallback = dateInFolderDefault.use();
  const [initial] = useState(dateInFolder);
  const [dismissed, setDismissed] = useState(false);
  const asksToRemember =
    !dismissed && dateInFolder !== fallback && dateInFolder !== initial;

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
          disabled={disabled}
          onCheckedChange={onDateInFolderChange}
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
            type="button"
            variant="outline"
            size="sm"
            data-testid="remember-default-yes"
            className="h-6 text-xs"
            onClick={() => dateInFolderDefault.set(dateInFolder)}
          >
            Remember
          </Button>
          <Button
            type="button"
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
