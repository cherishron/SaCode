import type { AgentStoreData } from "../../lib/agent-store.js";
import type { ProviderStoreData } from "../../lib/provider-store.js";
import { routeSlashCommand } from "../../lib/command-router.js";

const SHARED_COMMANDS = new Set([
  "doctor",
  "tools",
  "context",
  "permissions",
  "models",
  "model",
  "providers",
  "agents",
  "agent",
  "lang",
  "prefs",
  "clear",
  "exit",
  "quit",
  "q",
]);

export interface SharedSlashRouterDependencies {
  input: string;
  tools: string[];
  workspaceContext: string;
  model: string;
  language: string;
  session?: string;
  preferences: Record<string, unknown>;
  providerStore?: ProviderStoreData;
  agentStore?: AgentStoreData;
  setLanguage: (language: string) => void;
  setCurrentModel: (model: string) => void;
  handleExit: () => void;
  appendSystemMessage: (content: string) => void;
  clearMessages: () => void;
}

export function shouldUseSharedSlashRouter(input: string): boolean {
  const command = input.trim().replace(/^\//, "").split(/\s+/)[0]?.toLowerCase();
  return Boolean(command && SHARED_COMMANDS.has(command));
}

export async function tryExecuteSharedSlashCommand(
  deps: SharedSlashRouterDependencies,
): Promise<boolean> {
  if (!shouldUseSharedSlashRouter(deps.input)) {
    return false;
  }

  const result = await routeSlashCommand(deps.input, {
    tools: deps.tools,
    workspaceContext: deps.workspaceContext,
    model: deps.model,
    language: deps.language,
    session: deps.session,
    confirmationMode: "dangerous",
    preferences: deps.preferences,
    providerStore: deps.providerStore,
    agentStore: deps.agentStore,
    setLanguage: (language) => {
      deps.setLanguage(language);
    },
  });

  if (result.type === "clear") {
    deps.clearMessages();
    return true;
  }

  if (result.type === "exit") {
    deps.handleExit();
    return true;
  }

  deps.appendSystemMessage(result.content);

  if (/^\/model\s+use\s+/i.test(deps.input) && deps.providerStore?.defaultModel) {
    deps.setCurrentModel(deps.providerStore.defaultModel);
  }

  return true;
}
