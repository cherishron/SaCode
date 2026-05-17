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

  it("registers expected command structure for restored entry points", () => {
    const program = new Command();
    const ctx = { program };

    registerCodeCommand(ctx);
    registerCronCommand(ctx);
    registerPluginCommand(ctx);
    registerWorkspaceCommand(ctx);
    registerStartCommand(ctx);

    const start = program.commands.find((command) => command.name() === "start");
    const workspace = program.commands.find((command) => command.name() === "workspace");
    const code = program.commands.find((command) => command.name() === "code");
    const cron = program.commands.find((command) => command.name() === "cron");
    const plugin = program.commands.find((command) => command.name() === "plugin");

    expect(start?.options.map((option) => option.flags)).toEqual(expect.arrayContaining([
      "-p, --port <port>",
      "-H, --host <host>",
      "--api",
      "--web",
    ]));

    expect(workspace?.commands.map((command) => command.name())).toEqual(expect.arrayContaining([
      "init",
      "show",
      "templates",
      "edit",
    ]));

    expect(code?.commands.map((command) => command.name())).toEqual(expect.arrayContaining([
      "run",
      "explain",
      "search",
      "refactor",
    ]));

    expect(cron?.commands.map((command) => command.name())).toEqual(expect.arrayContaining([
      "list",
      "add",
      "remove",
      "enable",
      "disable",
      "run",
      "stats",
    ]));

    expect(plugin?.commands.map((command) => command.name())).toEqual(expect.arrayContaining([
      "list",
      "install",
      "uninstall",
      "enable",
      "disable",
      "info",
    ]));
  });
});
