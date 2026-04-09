/**
 * Nord 主题
 *
 * https://www.nordtheme.com/
 */

import type { ThemeDefinition, SemanticColors } from "../semantic-tokens.js";

export const nordColors: SemanticColors = {
  text: {
    primary: "#eceff4",
    secondary: "#d8dee9",
    link: "#88c0d0",
    accent: "#81a1c1",
    response: "#a3be8c",
    user: "#88c0d0",
    system: "#4c566a",
    comment: "#616e88",
    placeholder: "#4c566a",
  },
  background: {
    primary: "#2e3440",
    message: "#3b4252",
    input: "#2e3440",
    focus: "#434c5e80",
    selection: "#434c5e99",
    diff: {
      added: "#a3be8c26",
      removed: "#bf616a26",
      modified: "#ebcb8b26",
    },
    tool: "#3b4252",
    error: "#bf616a1a",
    warning: "#ebcb8b1a",
    success: "#a3be8c1a",
  },
  border: {
    default: "#4c566a",
    accent: "#88c0d0",
    focus: "#88c0d0",
    error: "#bf616a",
    success: "#a3be8c",
  },
  status: {
    error: "#bf616a",
    success: "#a3be8c",
    warning: "#ebcb8b",
    info: "#88c0d0",
    pending: "#ebcb8b",
    running: "#88c0d0",
  },
  ui: {
    comment: "#616e88",
    symbol: "#81a1c1",
    active: "#88c0d0",
    dark: "#242933",
    focus: "#88c0d0",
    gradient: ["#88c0d0", "#81a1c1", "#b48ead"],
    highlight: "#ebcb8b",
    cursor: "#eceff4",
  },
  syntax: {
    keyword: "#81a1c1",
    string: "#a3be8c",
    number: "#b48ead",
    comment: "#616e88",
    function: "#88c0d0",
    class: "#8fbcbb",
    variable: "#d8dee9",
    operator: "#81a1c1",
    punctuation: "#eceff4",
    property: "#88c0d0",
    tag: "#81a1c1",
    attributeName: "#8fbcbb",
    attributeValue: "#a3be8c",
    regex: "#a3be8c",
    builtin: "#8fbcbb",
    constant: "#b48ead",
    deleted: "#bf616a",
    inserted: "#a3be8c",
    changed: "#ebcb8b",
  },
};

export const nordTheme: ThemeDefinition = {
  name: "Nord",
  type: "dark",
  builtIn: true,
  colors: nordColors,
  borderStyle: "none",
  description: "Nord theme - An arctic, north-bluish color palette",
  author: "Nord Theme",
};

export default nordTheme;
