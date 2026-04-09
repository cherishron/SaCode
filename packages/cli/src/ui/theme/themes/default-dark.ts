/**
 * 默认深色主题
 *
 * 基于 GitHub Dark 配色方案
 */

import type { ThemeDefinition, SemanticColors } from "../semantic-tokens.js";

export const defaultDarkColors: SemanticColors = {
  text: {
    primary: "#e6edf3",
    secondary: "#7d8590",
    link: "#2f81f7",
    accent: "#ff7b72",
    response: "#3fb950",
    user: "#58a6ff",
    system: "#7d8590",
    comment: "#6e7681",
    placeholder: "#484f58",
  },
  background: {
    primary: "#0d1117",
    message: "#161b22",
    input: "#0d1117",
    focus: "#1f6feb26",
    selection: "#1f6feb4d",
    diff: {
      added: "#23863626",
      removed: "#da363326",
      modified: "#d2992226",
    },
    tool: "#21262d",
    error: "#f851491a",
    warning: "#d299221a",
    success: "#2386361a",
  },
  border: {
    default: "#30363d",
    accent: "#1f6feb",
    focus: "#1f6feb",
    error: "#f85149",
    success: "#238636",
  },
  status: {
    error: "#f85149",
    success: "#3fb950",
    warning: "#d29922",
    info: "#2f81f7",
    pending: "#d29922",
    running: "#2f81f7",
  },
  ui: {
    comment: "#6e7681",
    symbol: "#58a6ff",
    active: "#1f6feb",
    dark: "#010409",
    focus: "#1f6feb",
    gradient: ["#58a6ff", "#a371f7", "#f778ba"],
    highlight: "#bb8009",
    cursor: "#58a6ff",
  },
  syntax: {
    keyword: "#ff7b72",
    string: "#a5d6ff",
    number: "#79c0ff",
    comment: "#8b949e",
    function: "#d2a8ff",
    class: "#7ee787",
    variable: "#ffa657",
    operator: "#ff7b72",
    punctuation: "#c9d1d9",
    property: "#79c0ff",
    tag: "#7ee787",
    attributeName: "#79c0ff",
    attributeValue: "#a5d6ff",
    regex: "#7ee787",
    builtin: "#ffa657",
    constant: "#79c0ff",
    deleted: "#ffa198",
    inserted: "#7ee787",
    changed: "#ffa657",
  },
};

export const defaultDarkTheme: ThemeDefinition = {
  name: "Default Dark",
  type: "dark",
  builtIn: true,
  colors: defaultDarkColors,
  borderStyle: "none",
  description: "GitHub Dark inspired theme",
  author: "SaCode",
};

export default defaultDarkTheme;
