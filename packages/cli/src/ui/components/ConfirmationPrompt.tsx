import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { getColors, toInkColor } from "../theme/index.js";

export interface ConfirmationPromptProps {
  title: string;
  message: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  details?: string[];
  onConfirm: () => void;
  onCancel: () => void;
}

const riskLabels: Record<string, { label: string; color: "yellow" | "red" }> = {
  low: { label: "[!]", color: "yellow" },
  medium: { label: "[!!]", color: "yellow" },
  high: { label: "[!!!]", color: "red" },
  critical: { label: "[CRITICAL]", color: "red" },
};

export const ConfirmationPrompt: React.FC<ConfirmationPromptProps> = ({
  title,
  message,
  riskLevel,
  details,
  onConfirm,
  onCancel,
}) => {
  const colors = getColors();
  const [selectedAction, setSelectedAction] = useState<"allow" | "deny">("deny");
  const risk = riskLabels[riskLevel];

  useInput(
    useCallback(
      (input, key) => {
        if (key.leftArrow || key.rightArrow || key.tab) {
          setSelectedAction((prev) => (prev === "allow" ? "deny" : "allow"));
        } else if (key.return) {
          if (selectedAction === "allow") {
            onConfirm();
          } else {
            onCancel();
          }
        } else if (key.escape) {
          onCancel();
        } else if (input === "y" || input === "Y") {
          onConfirm();
        } else if (input === "n" || input === "N") {
          onCancel();
        }
      },
      [selectedAction, onConfirm, onCancel],
    ),
  );

  return (
    <Box
      flexDirection="column"
      marginY={1}
      borderStyle="round"
      borderColor={risk.color === "red" ? "red" : "yellow"}
      paddingX={1}
    >
      <Box marginBottom={1}>
        <Text bold color={risk.color}>
          {risk.label}
        </Text>
        <Text> </Text>
        <Text bold>{title}</Text>
      </Box>

      <Box marginLeft={2} marginBottom={1}>
        <Text>{message}</Text>
      </Box>

      {details && details.length > 0 && (
        <Box flexDirection="column" marginLeft={2} marginBottom={1}>
          {details.map((detail, i) => (
            <Text key={i} dimColor>
              {"  "}| {detail}
            </Text>
          ))}
        </Box>
      )}

      <Box marginLeft={2} marginTop={1}>
        <Text
          bold={selectedAction === "allow"}
          inverse={selectedAction === "allow"}
          color={
            selectedAction === "allow"
              ? "red"
              : toInkColor(colors.text.muted ?? colors.text.secondary)
          }
        >
          {selectedAction === "allow" ? "> " : "  "}允许(Y)
        </Text>
        <Text>  </Text>
        <Text
          bold={selectedAction === "deny"}
          inverse={selectedAction === "deny"}
          color={
            selectedAction === "deny"
              ? toInkColor(colors.text.accent)
              : toInkColor(colors.text.muted ?? colors.text.secondary)
          }
        >
          {selectedAction === "deny" ? "> " : "  "}拒绝(N)
        </Text>
      </Box>

      <Box marginLeft={2} marginTop={1}>
        <Text dimColor>
          左右键/Tab 切换 | Y 允许 | N 拒绝 | Enter 确认 | Esc 取消
        </Text>
      </Box>
    </Box>
  );
};
