import type { ProviderConfig } from "@sacode/core";
import type { WorkspaceContextSummary } from "./workspace-context";

export type PrintOutputFormat = "text" | "json" | "stream-json";

export interface PrintOptions {
  json?: boolean;
  streamJson?: boolean;
}

export interface JsonEvent {
  type: string;
  [key: string]: unknown;
}

export interface CompleteEventInput {
  content: string;
  session?: string;
  providerConfig: ProviderConfig;
  durationMs: number;
  errors: string[];
  workspace: WorkspaceContextSummary;
  events?: JsonEvent[];
}

export function getPrintOutputFormat(options: PrintOptions): PrintOutputFormat {
  if (options.streamJson) return "stream-json";
  if (options.json) return "json";
  return "text";
}

export function createStartEvent(input: {
  session?: string;
  providerConfig: ProviderConfig;
  workspace: WorkspaceContextSummary;
}): JsonEvent {
  return {
    type: "start",
    session: input.session ?? "default",
    model: input.providerConfig.model ?? "default",
    workspace: input.workspace,
  };
}

export function createAssistantDeltaEvent(text: string): JsonEvent {
  return { type: "assistant_delta", text };
}

export function createSystemEvent(message: string): JsonEvent {
  return { type: "system", message };
}

export function createCompleteEvent(input: CompleteEventInput): JsonEvent {
  return {
    type: "complete",
    content: input.content,
    session: input.session ?? "default",
    model: input.providerConfig.model ?? "default",
    durationMs: input.durationMs,
    success: input.errors.length === 0,
    errors: input.errors,
    workspace: input.workspace,
    ...(input.events ? { events: input.events } : {}),
  };
}

export function serializeJsonEvent(event: JsonEvent): string {
  return `${JSON.stringify(event)}\n`;
}
