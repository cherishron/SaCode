import chalk from "chalk";

interface Plugin {
  name: string;
  version: string;
  enabled: boolean;
}

const plugins: Plugin[] = [];

export async function listPlugins(): Promise<void> {
  console.log(chalk.cyan("🔌 Plugins\n"));

  if (plugins.length === 0) {
    console.log(chalk.gray("  No plugins installed"));
  } else {
    for (const plugin of plugins) {
      const status = plugin.enabled ? chalk.green("✓") : chalk.red("✗");
      console.log(`  ${status} ${plugin.name} v${plugin.version}`);
    }
  }

  console.log();
  console.log(chalk.gray("Use 'SACODE plugin install <path>' to install a plugin"));
}

export async function installPlugin(path: string): Promise<void> {
  console.log(chalk.cyan(`📦 Installing plugin from ${path}...`));

  // TODO: 实际安装逻辑
  plugins.push({
    name: path.split("/").pop()?.replace(".js", "") || "unknown",
    version: "1.0.0",
    enabled: true,
  });

  console.log(chalk.green("✓ Plugin installed successfully"));
}

export async function enablePlugin(name: string): Promise<void> {
  const plugin = plugins.find((p) => p.name === name);

  if (!plugin) {
    console.log(chalk.red(`Plugin not found: ${name}`));
    return;
  }

  plugin.enabled = true;
  console.log(chalk.green(`✓ Plugin enabled: ${name}`));
}

export async function disablePlugin(name: string): Promise<void> {
  const plugin = plugins.find((p) => p.name === name);

  if (!plugin) {
    console.log(chalk.red(`Plugin not found: ${name}`));
    return;
  }

  plugin.enabled = false;
  console.log(chalk.green(`✓ Plugin disabled: ${name}`));
}
