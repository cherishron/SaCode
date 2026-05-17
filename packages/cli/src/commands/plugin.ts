import chalk from "chalk";
import type { PluginManager, Plugin } from "@sacode/core";

const defaultPluginsDir = process.env.SACODE_PLUGINS_DIR || ".sacode/plugins";

let pluginManagerInstance: PluginManager | null = null;

async function getPluginManager(): Promise<PluginManager> {
  if (!pluginManagerInstance) {
    const { createPluginManager } = await import("@sacode/core");

    pluginManagerInstance = createPluginManager(
      { pluginsDir: defaultPluginsDir },
      {
        adapters: {} as never,
        scheduler: {} as never,
        database: null as never,
        client: {} as never,
      }
    );
    await pluginManagerInstance.initialize();
  }
  return pluginManagerInstance;
}

export async function listPlugins(): Promise<void> {
  const manager = await getPluginManager();
  const plugins = manager.getAll();

  console.log(chalk.cyan("[D] Plugins\n"));

  if (plugins.length === 0) {
    console.log(chalk.gray("[!] No plugins found"));
  } else {
    for (const plugin of plugins) {
      const statusIcon = getStatusIcon(plugin.status);
      console.log(`  ${statusIcon} ${chalk.bold(plugin.name)} v${plugin.version}`);
      console.log(`      ${chalk.gray("Status:")} ${plugin.status}`);
      if (plugin.manifest.description) {
        console.log(`      ${chalk.gray("Desc:")} ${plugin.manifest.description}`);
      }
      if (plugin.path) {
        console.log(`      ${chalk.gray("Path:")} ${plugin.path}`);
      }
      console.log();
    }
  }

  console.log(chalk.gray("Use 'sacode plugin install <source>' to install a plugin"));
}

export async function installPlugin(name: string, source?: string): Promise<void> {
  const manager = await getPluginManager();

  console.log(chalk.cyan(`[PKG] Installing plugin: ${name}${source ? ` from ${source}` : ""}...`));

  try {
    const plugin = await manager.install(name, source);
    console.log(chalk.green("+ Plugin installed successfully"));
    console.log(chalk.gray(`  Name:    ${plugin.name}`));
    console.log(chalk.gray(`  Version: ${plugin.version}`));
    console.log(chalk.gray(`  Status:  ${plugin.status}`));
  } catch (e) {
    console.log(chalk.red(`[x] Failed to install plugin: ${e instanceof Error ? e.message : String(e)}`));
  }
}

export async function uninstallPlugin(name: string): Promise<void> {
  const manager = await getPluginManager();

  try {
    await manager.uninstall(name);
    console.log(chalk.green(`+ Plugin uninstalled: ${name}`));
  } catch (e) {
    console.log(chalk.red(`[x] Failed to uninstall plugin: ${e instanceof Error ? e.message : String(e)}`));
  }
}

export async function enablePlugin(name: string): Promise<void> {
  const manager = await getPluginManager();

  try {
    await manager.enable(name);
    console.log(chalk.green(`+ Plugin enabled: ${name}`));
  } catch (e) {
    console.log(chalk.red(`[x] Failed to enable plugin: ${e instanceof Error ? e.message : String(e)}`));
  }
}

export async function disablePlugin(name: string): Promise<void> {
  const manager = await getPluginManager();

  try {
    await manager.disable(name);
    console.log(chalk.red(`o Plugin disabled: ${name}`));
  } catch (e) {
    console.log(chalk.red(`[x] Failed to disable plugin: ${e instanceof Error ? e.message : String(e)}`));
  }
}

export async function showPluginInfo(name: string): Promise<void> {
  const manager = await getPluginManager();
  const plugin = manager.get(name);

  if (!plugin) {
    console.log(chalk.red(`[x] Plugin not found: ${name}`));
    return;
  }

  console.log(chalk.cyan(`[D] Plugin: ${plugin.name}\n`));
  console.log(`  ${chalk.gray("Name:")}     ${plugin.name}`);
  console.log(`  ${chalk.gray("Version:")}  ${plugin.version}`);
  console.log(`  ${chalk.gray("Status:")}   ${plugin.status}`);
  if (plugin.manifest.description) {
    console.log(`  ${chalk.gray("Desc:")}     ${plugin.manifest.description}`);
  }
  if (plugin.manifest.author) {
    console.log(`  ${chalk.gray("Author:")}   ${plugin.manifest.author}`);
  }
  if (plugin.path) {
    console.log(`  ${chalk.gray("Path:")}     ${plugin.path}`);
  }
  if (plugin.error) {
    console.log(`  ${chalk.gray("Error:")}    ${chalk.red(plugin.error.message)}`);
  }
}

function getStatusIcon(status: Plugin["status"]): string {
  switch (status) {
    case "enabled": return chalk.green("*");
    case "installed": return chalk.blue("+");
    case "discovered": return chalk.gray("?");
    case "error": return chalk.red("x");
    case "disabled": return chalk.yellow("o");
    default: return chalk.gray("-");
  }
}
