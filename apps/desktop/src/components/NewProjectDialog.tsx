import { Button } from "@photopipe/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@photopipe/ui/components/dialog";
import { Input } from "@photopipe/ui/components/input";
import { Label } from "@photopipe/ui/components/label";
import { Textarea } from "@photopipe/ui/components/textarea";
import { Loader2 } from "lucide-react";
import { useState } from "react";
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
  const [name, setName] = useState("");
  const [day, setDay] = useState(today);
  const [notes, setNotes] = useState("");
  const create = useCreateProject();

  const reset = () => {
    setName("");
    setDay(today());
    setNotes("");
    create.reset();
  };

  const submit = () => {
    create.mutate(
      { day, name: name.trim(), notes },
      {
        onSuccess: (result) => {
          onOpenChange(false);
          reset();
          onCreated(result.shoot);
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading">New project</DialogTitle>
          <DialogDescription>
            Creates{" "}
            <span className="font-mono">
              {day}_{name.trim() || "name"}
            </span>{" "}
            with an <span className="font-mono">original/</span> folder ready
            for photos.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) submit();
          }}
        >
          <div className="flex gap-3">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="project-name">Project</Label>
              <Input
                id="project-name"
                data-testid="project-name"
                value={name}
                autoFocus
                placeholder="zell"
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="project-day">Date</Label>
              <Input
                id="project-day"
                data-testid="project-day"
                type="date"
                value={day}
                onChange={(event) => setDay(event.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="project-notes">Notes</Label>
            <Textarea
              id="project-notes"
              data-testid="project-notes"
              value={notes}
              rows={3}
              placeholder="Anything worth remembering about this shoot."
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
        </form>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            data-testid="create-project"
            disabled={!name.trim() || create.isPending}
            onClick={submit}
          >
            {create.isPending && <Loader2 className="animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
