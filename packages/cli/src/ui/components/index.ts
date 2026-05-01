/**
 * UI 组件导出
 */

export { CodeHighlight, InlineCode, detectLanguage, getSupportedLanguages } from "./CodeHighlight.js";
export type { CodeHighlightProps, InlineCodeProps } from "./CodeHighlight.js";

export { MarkdownDisplay, parseMarkdown } from "./MarkdownDisplay.js";
export type { MarkdownDisplayProps, MarkdownNode, MarkdownNodeType } from "./MarkdownDisplay.js";

export { ThemedGradient, GradientLogo, GradientSpinner } from "./ThemedGradient.js";
export type { ThemedGradientProps, GradientLogoProps, GradientSpinnerProps } from "./ThemedGradient.js";

export { Suggestions } from "./Suggestions.js";
export type { SuggestionsProps } from "./Suggestions.js";

export { ToolCallDisplay } from "./ToolCallDisplay.js";
export type { ToolCallDisplayProps, ToolStatus } from "./ToolCallDisplay.js";

export { ReverseSearchOverlay } from "./ReverseSearchOverlay.js";
export type { ReverseSearchOverlayProps } from "./ReverseSearchOverlay.js";

export { GeminiHeader } from "./GeminiHeader.js";
export { WelcomeScreen } from "./WelcomeScreen.js";

export { ExitSummary } from "./ExitSummary.js";
export type { ExitSummaryProps } from "./ExitSummary.js";

export { ChoicePrompt } from "./ChoicePrompt.js";
export type { ChoicePromptProps, ChoiceOption } from "./ChoicePrompt.js";

export { ConfirmationPrompt } from "./ConfirmationPrompt.js";
export type { ConfirmationPromptProps } from "./ConfirmationPrompt.js";

// 新增导出组件
export { StatusBar } from "./StatusBar.js";
export { StreamingMessage } from "./StreamingMessage.js";
export { ToolCallPanel } from "./ToolCallPanel.js";
export { ThinkingIndicator } from "./ThinkingIndicator.js";