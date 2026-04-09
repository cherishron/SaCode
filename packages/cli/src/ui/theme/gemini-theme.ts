/**
 * Gemini 风格主题
 * Primary: #4285F4 (Google Blue)
 * Accent: #A142F4 (Purple)
 */

export const geminiTheme = {
  name: "gemini",
  colors: {
    primary: "#4285F4",
    accent: "#A142F4",
    success: "#34A853",
    warning: "#FBBC04",
    error: "#EA4335",
    info: "#4285F4",
    muted: "#9AA0A6",
    background: "#1A1A2E",
    surface: "#16213E",
    text: "#E8EAED",
    textSecondary: "#9AA0A6",
    border: "#3C4043",
  },
  gradient: {
    header: ["#4285F4", "#A142F4"],
    thinking: ["#4285F4", "#A142F4", "#4285F4"],
  },
  labels: {
    thinking: "Thinking",
    toolCall: "Tool",
    streaming: "Generating",
    done: "Done",
    error: "Error",
  },
} as const;

export type GeminiTheme = typeof geminiTheme;
