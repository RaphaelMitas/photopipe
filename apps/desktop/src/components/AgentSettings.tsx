import { Button } from "@photopipe/ui/components/button";
import { Label } from "@photopipe/ui/components/label";
import { Segmented } from "@photopipe/ui/components/segmented";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import {
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
    "Also the photos themselves, rendered on this Mac and sent to the agent, which may send them on to its model's provider.",
};

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
  const see = access?.see ?? "off";
  return (
    <>
      <div className="flex flex-col gap-2">
        <Label>What agents can see</Label>
        <Segmented
          value={see}
          options={SEE}
          testid="agent-see"
          disabled={access ? undefined : SEE.map(([value]) => value)}
          onChange={(value) => setAccess.mutate({ ...access, see: value })}
        />
        <p className="text-muted-foreground text-xs">{SEE_DETAIL[see]}</p>
      </div>
      {executable && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label>Connect an agent</Label>
            <p className="text-muted-foreground text-xs">
              Agents talk to Photopipe while it's open, and open it in the
              background when it isn't. Reconnect the agent after you change
              what it can see.
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
