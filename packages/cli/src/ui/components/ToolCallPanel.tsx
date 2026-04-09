import React from "react";
import { Text, Box } from "ink";
import { geminiTheme } from "../theme/gemini-theme.js";

interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "running" | "done" | "error";
  result?: unknown;
  duration?: number;
}

interface ToolCallPanelProps {
  toolCalls: ToolCall[];
  expanded?: boolean;
}

const statusIcon = (status: ToolCall["status"]): string => {
  switch (status) {
    case "running": return "⟳";
    case "done": return "✓";
    case "error": return "✗";
  }
};

const statusColor = (status: ToolCall["status"]): string => {
  switch (status) {
    case "running": return geminiTheme.colors.primary;
    case "done": return geminiTheme.colors.success;
    case "error": return geminiTheme.colors.error;
  }
};

export const ToolCallPanel: React.FC<ToolCallPanelProps> = ({
  toolCalls,
  expanded = false,
}) => {
  if (toolCalls.length === 0) return null;

  return (
    <Box flexDirection="column" marginLeft={1}>
      {toolCalls.map((tc) => (
        <Box key={tc.id} flexDirection="column">
          <Box>
            <Text color={statusColor(tc.status)}>
              {statusIcon(tc.status)}
            </Text>
            <Text color={geminiTheme.colors.text}> {tc.name}</Text>
            {tc.duration !== undefined && (
              <Text color={geminiTheme.colors.muted}> ({tc.duration}ms)</Text>
            )}
          </Box>
          {expanded && tc.args && Object.keys(tc.args).length > 0 && (
            <Box marginLeft={2}>
              <Text color={geminiTheme.colors.muted}>
                {JSON.stringify(tc.args, null, 2).slice(0, 200)}
              </Text>
            </Box>
          )}
        </Box>
      ))}
    </Box>
  );
};
