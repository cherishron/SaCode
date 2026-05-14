import {
  CapabilitiesManager,
  defaultCapabilitiesConfig,
} from "@sacode/capabilities";
import {
  createToolConfirmationManager,
  type CapabilitiesRegistryLike,
  type ConfirmationMode,
  type ConfirmationRequest,
} from "@sacode/core";

export interface CliConfirmationOptions {
  mode?: ConfirmationMode;
  sessionId?: string;
  confirm?: (request: ConfirmationRequest) => Promise<boolean>;
}

export interface CliToolRegistryContext {
  capabilities: CapabilitiesManager;
  registry: CapabilitiesRegistryLike;
  confirmationMode: ConfirmationMode;
}

export function createCliCapabilities(cwd = process.cwd()): CapabilitiesManager {
  return new CapabilitiesManager({
    ...defaultCapabilitiesConfig,
    files: {
      ...defaultCapabilitiesConfig.files,
      allowedDirs: [cwd, "."],
    },
  });
}

export function createCliToolRegistryAdapter(
  cwd = process.cwd(),
  options: CliConfirmationOptions = {}
): CliToolRegistryContext {
  const capabilities = createCliCapabilities(cwd);
  const rawRegistry = capabilities.getRegistry();
  const confirmationMode = options.mode ?? "dangerous";
  const confirmationManager = createToolConfirmationManager({
    mode: confirmationMode,
    timeout: 300000,
  });

  confirmationManager.on("request", (request) => {
    void (async () => {
      const confirmed = options.confirm ? await options.confirm(request) : false;
      confirmationManager.respond(request.id, confirmed);
    })().catch(() => confirmationManager.respond(request.id, false));
  });

  const registry: CapabilitiesRegistryLike = {
    list: () => rawRegistry.list(),
    has: (name) => rawRegistry.has(name),
    execute: async (name, input) => {
      const args = toRecord(input);
      const confirmed = await confirmationManager.requestConfirmation({
        toolName: name,
        args,
        sessionId: options.sessionId ?? "cli",
      });

      if (!confirmed) {
        throw new Error(`Tool execution denied: ${name}`);
      }

      return rawRegistry.execute(name, input);
    },
  };

  return {
    capabilities,
    registry,
    confirmationMode,
  };
}

function toRecord(input: unknown): Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
}
