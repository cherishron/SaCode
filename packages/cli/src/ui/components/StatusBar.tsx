import React from "react";
import { Text, Box } from "ink";
import { geminiTheme } from "../theme/gemini-theme.js";
import type { TokenUsage } from "../types.js";

interface StatusBarProps {
  tokenUsage?: TokenUsage;
  status: "idle" | "thinking" | "streaming" | "done" | "error";
}

export const StatusBar: React.FC<StatusBarProps> = ({
  tokenUsage,
  status,
}) => {
  const statusText: Record<string, string> = {
    idle: "Ready",
    thinking: "Thinking...",
    streaming: "Generating...",
    done: "Done",
    error: "Error",
  };

  const statusColor: Record<string, string> = {
    idle: geminiTheme.colors.muted,
    thinking: geminiTheme.colors.primary,
    streaming: geminiTheme.colors.accent,
    done: geminiTheme.colors.success,
    error: geminiTheme.colors.error,
  };

  return (
    <Box
      flexDirection="row"
      justifyContent="space-between"
      borderStyle="single"
      borderColor={geminiTheme.colors.border}
      paddingX={1}
    >
      <Text color={statusColor[status] ?? geminiTheme.colors.muted}>{statusText[status] ?? "Ready"}</Text>
      {tokenUsage && (
        <Text color={geminiTheme.colors.muted}>
          Tokens: {tokenUsage.totalTokens}
        </Text>
      )}
    </Box>
  );
};
