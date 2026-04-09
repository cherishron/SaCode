import React from "react";
import { Text, Box } from "ink";
import { geminiTheme } from "../theme/gemini-theme.js";

interface FileNode {
  name: string;
  type: "file" | "directory";
  children?: FileNode[];
  modified?: boolean;
}

interface FileTreeViewProps {
  root: FileNode;
  depth?: number;
}

export const FileTreeView: React.FC<FileTreeViewProps> = ({
  root,
  depth = 0,
}) => {
  const indent = "  ".repeat(depth);
  const icon = root.type === "directory" ? "📁" : "📄";
  const color = root.modified ? geminiTheme.colors.warning : geminiTheme.colors.text;

  return (
    <Box flexDirection="column">
      <Text color={color}>
        {indent}{icon} {root.name}
      </Text>
      {root.children?.map((child, i) => (
        <FileTreeView key={i} root={child} depth={depth + 1} />
      ))}
    </Box>
  );
};
