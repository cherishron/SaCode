import React, { useState, useEffect } from "react";
import { Text, Box } from "ink";
import { geminiTheme } from "../theme/gemini-theme.js";

interface ThinkingIndicatorProps {
  text?: string;
  toolName?: string;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export const ThinkingIndicator: React.FC<ThinkingIndicatorProps> = ({
  text = "Thinking",
  toolName,
}) => {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, 80);
    return () => clearInterval(timer);
  }, []);

  return (
    <Box>
      <Text color={geminiTheme.colors.accent}>
        {SPINNER_FRAMES[frame]}
      </Text>
      <Text color={geminiTheme.colors.primary}> {text}</Text>
      {toolName && (
        <Text color={geminiTheme.colors.muted}> — {toolName}</Text>
      )}
    </Box>
  );
};
