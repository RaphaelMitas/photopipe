import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";

export type AgentSee = "off" | "details" | "pictures";

export type AgentAccess = { see: AgentSee };

const ACCESS_KEY = ["agentAccess"];

export function useAgentAccess() {
  return useQuery({
    queryKey: ACCESS_KEY,
    queryFn: () => invoke<AgentAccess>("agent_access"),
  });
}

export function useSetAgentAccess() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (access: AgentAccess) =>
      invoke<void>("set_agent_access", { access }),
    onMutate: (access) => queryClient.setQueryData(ACCESS_KEY, access),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ACCESS_KEY }),
  });
}

export function useAgentCommand() {
  return useQuery({
    queryKey: ["agentCommand"],
    queryFn: () => invoke<string | null>("agent_command"),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function claudeCodeCommand(executable: string) {
  return `claude mcp add photopipe -- '${executable.replaceAll("'", "'\\''")}' --mcp`;
}

export function clientConfig(executable: string) {
  return JSON.stringify(
    { mcpServers: { photopipe: { command: executable, args: ["--mcp"] } } },
    null,
    2,
  );
}
