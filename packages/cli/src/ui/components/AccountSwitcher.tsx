import React from "react";
import { Text, Box } from "ink";
import { geminiTheme } from "../theme/gemini-theme.js";

interface Account {
  id: string;
  alias: string;
  provider: string;
  isActive: boolean;
}

interface AccountSwitcherProps {
  accounts: Account[];
  onSelect?: (id: string) => void;
}

export const AccountSwitcher: React.FC<AccountSwitcherProps> = ({
  accounts,
}) => {
  return (
    <Box flexDirection="column" marginY={1}>
      <Text bold color={geminiTheme.colors.primary}>
        CodingPlan Accounts
      </Text>
      {accounts.map((acc) => (
        <Box key={acc.id} marginLeft={1}>
          <Text color={acc.isActive ? geminiTheme.colors.accent : geminiTheme.colors.muted}>
            {acc.isActive ? "* " : "o "}
          </Text>
          <Text color={acc.isActive ? geminiTheme.colors.text : geminiTheme.colors.muted}>
            {acc.alias}
          </Text>
          <Text color={geminiTheme.colors.muted}> ({acc.provider})</Text>
        </Box>
      ))}
    </Box>
  );
};
