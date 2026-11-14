import { Button } from "@photopipe/ui/components/button";
import { Label } from "@photopipe/ui/components/label";
import { Segmented } from "@photopipe/ui/components/segmented";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import {
  type AgentAccess,
  type AgentAct,
  type AgentSee,
  claudeCodeCommand,
  clientConfig,
  useAgentAccess,
  useAgentCommand,
  useSetAgentAccess,
} from "@/lib/agents";

const SEE: readonly [AgentSee, string][] = [
  ["off", "Nothing"],
  ["details", "Details"],
  ["pictures", "Pictures"],
];

const SEE_DETAIL: Record<AgentSee, string> = {
  off: "Agents get no tools at all.",
  details:
    "Projects, ratings, flags, capture times, camera settings and edits. No pixels leave Photopipe.",
  pictures:
    "Also the photos themselves, rendered on this Mac and sent to the agent, which may send them on to its model's provider, and where the original files are.",
};

const ACT: readonly [AgentAct, string][] = [
  ["off", "Nothing"],
  ["cull", "Cull & edit"],
  ["everything", "Everything"],
];

const ACT_DETAIL: Record<AgentAct, string> = {
  off: "Agents can only read.",
  cull: "Open shoots and photos, rate, flag, edit, undo and press the app's keys. Each change is a step in History you can undo, and agents need to see at least details to make one.",
  everything: "Also export, and move photos to the Trash.",
};

function Choice<T extends string>({
  label,
  testid,
  options,
  details,
  value,
  onChange,
}: {
  label: string;
  testid: string;
  options: readonly [T, string][];
  details: Record<T, string>;
  value: T | undefined;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      <Segmented
        value={value ?? options[0][0]}
        options={options}
        testid={testid}
        disabled={
          value === undefined ? options.map(([option]) => option) : undefined
        }
        onChange={onChange}
      />
      <p className="text-muted-foreground text-xs">
        {details[value ?? options[0][0]]}
      </p>
    </div>
  );
}

function Snippet({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-xs">{label}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            navigator.clipboard.writeText(text).then(
              () => toast("Copied", { id: "agent-copy" }),
              () => toast.error("Couldn't copy", { id: "agent-copy" }),
            )
          }
        >
          <Copy />
          Copy
        </Button>
      </div>
      <pre className="whitespace-pre-wrap break-all rounded-lg bg-muted p-3 font-mono text-xs">
        {text}
      </pre>
    </div>
  );
}

export function AgentSettings() {
  const access = useAgentAccess().data;
  const setAccess = useSetAgentAccess();
  const executable = useAgentCommand().data;
  const update = (change: Partial<AgentAccess>) =>
    access && setAccess.mutate({ ...access, ...change });
  return (
    <>
      <Choice
        label="What agents can see"
        testid="agent-see"
        options={SEE}
        details={SEE_DETAIL}
        value={access?.see}
        onChange={(see) => update({ see })}
      />
      <Choice
        label="What agents can do"
        testid="agent-act"
        options={ACT}
        details={ACT_DETAIL}
        value={access?.act}
        onChange={(act) => update({ act })}
      />
      {executable && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label>Connect an agent</Label>
            <p className="text-muted-foreground text-xs">
              Agents talk to Photopipe while it's open, and open it in the
              background when it isn't. Reconnect the agent after you let it see
              more.
            </p>
          </div>
          <Snippet label="Claude Code" text={claudeCodeCommand(executable)} />
          <Snippet
            label="Claude Desktop, Cursor and other MCP clients"
            text={clientConfig(executable)}
          />
        </div>
      )}
    </>
  );
}
