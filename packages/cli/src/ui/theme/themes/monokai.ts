/**
 * Monokai 主题
 *
 * 经典的 Monokai 配色方案
 */

import type { ThemeDefinition, SemanticColors } from "../semantic-tokens.js";

export const monokaiColors: SemanticColors = {
  text: {
    primary: "#f8f8f2",
    secondary: "#75715e",
    link: "#66d9ef",
    accent: "#f92672",
    response: "#a6e22e",
    user: "#66d9ef",
    system: "#75715e",
    comment: "#75715e",
    placeholder: "#49483e",
  },
  background: {
    primary: "#272822",
    message: "#1e1f1c",
    input: "#272822",
    focus: "#49483e80",
    selection: "#49483e99",
    diff: {
      added: "#a6e22e26",
      removed: "#f9267226",
      modified: "#e6db7426",
    },
    tool: "#1e1f1c",
    error: "#f926721a",
    warning: "#e6db741a",
    success: "#a6e22e1a",
  },
  border: {
    default: "#49483e",
    accent: "#ae81ff",
    focus: "#ae81ff",
    error: "#f92672",
    success: "#a6e22e",
  },
  status: {
    error: "#f92672",
    success: "#a6e22e",
    warning: "#e6db74",
    info: "#66d9ef",
    pending: "#e6db74",
    running: "#66d9ef",
  },
  ui: {
    comment: "#75715e",
    symbol: "#ae81ff",
    active: "#ae81ff",
    dark: "#1e1f1c",
    focus: "#ae81ff",
    gradient: ["#66d9ef", "#ae81ff", "#f92672"],
    highlight: "#e6db74",
    cursor: "#f8f8f2",
  },
  syntax: {
    keyword: "#f92672",
    string: "#e6db74",
    number: "#ae81ff",
    comment: "#75715e",
    function: "#a6e22e",
    class: "#66d9ef",
    variable: "#f8f8f2",
    operator: "#f92672",
    punctuation: "#f8f8f2",
    property: "#a6e22e",
    tag: "#f92672",
    attributeName: "#a6e22e",
    attributeValue: "#e6db74",
    regex: "#e6db74",
    builtin: "#66d9ef",
    constant: "#ae81ff",
    deleted: "#f92672",
    inserted: "#a6e22e",
    changed: "#e6db74",
  },
};

export const monokaiTheme: ThemeDefinition = {
  name: "Monokai",
  type: "dark",
  builtIn: true,
  colors: monokaiColors,
  borderStyle: "round",
  description: "Monokai theme - Classic dark theme",
  author: "Wimer Hazenberg",
};

export default monokaiTheme;
