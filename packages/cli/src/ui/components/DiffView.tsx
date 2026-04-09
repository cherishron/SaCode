import React from "react";
import { Text, Box } from "ink";
import { geminiTheme } from "../theme/gemini-theme.js";

interface DiffLine {
  type: "add" | "remove" | "context";
  content: string;
  lineNumber?: number;
}

interface DiffViewProps {
  fileName: string;
  lines: DiffLine[];
}

export const DiffView: React.FC<DiffViewProps> = ({ fileName, lines }) => {
  const getColor = (type: DiffLine["type"]): string => {
    switch (type) {
      case "add": return geminiTheme.colors.success;
      case "remove": return geminiTheme.colors.error;
      case "context": return geminiTheme.colors.textSecondary;
    }
  };

  const getPrefix = (type: DiffLine["type"]): string => {
    switch (type) {
      case "add": return "+";
      case "remove": return "-";
      case "context": return " ";
    }
  };

  return (
    <Box flexDirection="column" marginY={1}>
      <Text bold color={geminiTheme.colors.primary}>
        --- {fileName}
      </Text>
      {lines.map((line, i) => (
        <Box key={i}>
          <Text color={geminiTheme.colors.muted}>
            {String(line.lineNumber ?? "").padStart(4)}
          </Text>
          <Text color={getColor(line.type)}>
            {getPrefix(line.type)} {line.content}
          </Text>
        </Box>
      ))}
    </Box>
  );
};
