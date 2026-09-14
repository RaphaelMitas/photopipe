import { Button } from "@photopipe/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@photopipe/ui/components/dialog";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { type ProjectDraft, ProjectFields } from "@/components/ProjectFields";
import { useCreateProject } from "@/lib/queries";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (shoot: string) => void;
};

export function NewProjectDialog({ open, onOpenChange, onCreated }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <NewProjectForm
          onCancel={() => onOpenChange(false)}
          onCreated={(shoot) => {
            onOpenChange(false);
            onCreated(shoot);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function NewProjectForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (shoot: string) => void;
}) {
  const [draft, setDraft] = useState<ProjectDraft>({ name: "", notes: "" });
  const create = useCreateProject();

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate(
          { name: draft.name.trim(), notes: draft.notes },
          { onSuccess: (result) => onCreated(result.shoot) },
        );
      }}
    >
      <DialogHeader>
        <DialogTitle className="font-heading">New project</DialogTitle>
        <DialogDescription>
          An empty folder in your library, ready for photos.
        </DialogDescription>
      </DialogHeader>

      <ProjectFields draft={draft} onChange={setDraft} />

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          data-testid="create-project"
          disabled={!draft.name.trim() || create.isPending}
        >
          {create.isPending && <Loader2 className="animate-spin" />}
          Create
        </Button>
      </DialogFooter>
    </form>
  );
}
