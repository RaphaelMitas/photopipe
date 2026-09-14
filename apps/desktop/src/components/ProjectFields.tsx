import { Input } from "@photopipe/ui/components/input";
import { Label } from "@photopipe/ui/components/label";
import { Textarea } from "@photopipe/ui/components/textarea";
import type { ReactNode } from "react";

export type ProjectDraft = { name: string; notes: string };

export function ProjectFields({
  draft,
  onChange,
  dateSlot,
}: {
  draft: ProjectDraft;
  onChange: (draft: ProjectDraft) => void;
  dateSlot?: ReactNode;
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
        {dateSlot}
      </div>

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
