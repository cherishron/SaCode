import { Command } from "commander";

export interface CommandContext {
  program: Command;
}

export type CommandRegister = (ctx: CommandContext) => void;
