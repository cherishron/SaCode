import { Command } from "commander";
import { describe, expect, it } from "vitest";
import {
  registerAuthCommand,
  registerChatCommand,
  registerCodeCommand,
  registerConfigCommand,
  registerCronCommand,
  registerModelCommand,
  registerPluginCommand,
  registerStartCommand,
  registerWorkspaceCommand,
} from "../index";

describe("command registration", () => {
  it("registers primary CLI commands on the root program", () => {
    const program = new Command();
    const ctx = { program };

    registerChatCommand(ctx);
    registerConfigCommand(ctx);
    registerModelCommand(ctx);
    registerAuthCommand(ctx);
    registerCodeCommand(ctx);
    registerCronCommand(ctx);
    registerPluginCommand(ctx);
    registerWorkspaceCommand(ctx);
    registerStartCommand(ctx);

    const commandNames = program.commands.map((command) => command.name());

    expect(commandNames).toEqual(expect.arrayContaining([
      "chat",
      "config",
      "model",
      "auth",
      "code",
      "cron",
      "plugin",
      "workspace",
      "start",
    ]));
  });
});
