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
import {
  type ProjectDraft,
  ProjectFields,
  projectRequest,
} from "@/components/ProjectFields";
import { dateInFolderDefault, projectFolder } from "@/lib/projectFolder";
import { useCreateProject } from "@/lib/queries";

function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

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
  const [draft, setDraft] = useState<ProjectDraft>(() => ({
    name: "",
    day: today(),
    dateInFolder: dateInFolderDefault.read(),
    notes: "",
  }));
  const create = useCreateProject();
  const folder = projectFolder(draft.name, draft.day, draft.dateInFolder);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate(projectRequest(draft), {
          onSuccess: (result) => onCreated(result.shoot),
        });
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
          disabled={!folder || create.isPending}
        >
          {create.isPending && <Loader2 className="animate-spin" />}
          Create
        </Button>
      </DialogFooter>
    </form>
  );
}
