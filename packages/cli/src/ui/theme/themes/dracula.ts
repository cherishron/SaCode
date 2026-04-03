/**
 * Dracula 主题
 *
 * https://draculatheme.com/
 */

import type { ThemeDefinition, SemanticColors } from "../semantic-tokens.js";

export const draculaColors: SemanticColors = {
  text: {
    primary: "#f8f8f2",
    secondary: "#6272a4",
    link: "#8be9fd",
    accent: "#ff79c6",
    response: "#50fa7b",
    user: "#8be9fd",
    system: "#6272a4",
    comment: "#6272a4",
    placeholder: "#44475a",
  },
  background: {
    primary: "#282a36",
    message: "#1e1f29",
    input: "#282a36",
    focus: "#44475a80",
    selection: "#44475a99",
    diff: {
      added: "#50fa7b26",
      removed: "#ff555526",
      modified: "#f1fa8c26",
    },
    tool: "#1e1f29",
    error: "#ff55551a",
    warning: "#f1fa8c1a",
    success: "#50fa7b1a",
  },
  border: {
    default: "#44475a",
    accent: "#bd93f9",
    focus: "#bd93f9",
    error: "#ff5555",
    success: "#50fa7b",
  },
  status: {
    error: "#ff5555",
    success: "#50fa7b",
    warning: "#f1fa8c",
    info: "#8be9fd",
    pending: "#f1fa8c",
    running: "#8be9fd",
  },
  ui: {
    comment: "#6272a4",
    symbol: "#bd93f9",
    active: "#bd93f9",
    dark: "#1e1f29",
    focus: "#bd93f9",
    gradient: ["#8be9fd", "#bd93f9", "#ff79c6"],
    highlight: "#f1fa8c",
    cursor: "#f8f8f2",
  },
  syntax: {
    keyword: "#ff79c6",
    string: "#f1fa8c",
    number: "#bd93f9",
    comment: "#6272a4",
    function: "#50fa7b",
    class: "#8be9fd",
    variable: "#f8f8f2",
    operator: "#ff79c6",
    punctuation: "#f8f8f2",
    property: "#66d9ef",
    tag: "#ff79c6",
    attributeName: "#50fa7b",
    attributeValue: "#f1fa8c",
    regex: "#f1fa8c",
    builtin: "#8be9fd",
    constant: "#bd93f9",
    deleted: "#ff5555",
    inserted: "#50fa7b",
    changed: "#f1fa8c",
  },
};

export const draculaTheme: ThemeDefinition = {
  name: "Dracula",
  type: "dark",
  builtIn: true,
  colors: draculaColors,
  borderStyle: "round",
  description: "Dracula theme - A dark theme for many editors",
  author: "Dracula Theme",
};

export default draculaTheme;
