/**
 * Marketplace 配置
 */

import * as fs from "fs";
import * as path from "path";
import type { PublishConfig } from "./types";
import { Platform } from "./types";

/**
 * 配置文件名
 */
export const CONFIG_FILE = "marketplace.config.json";

/**
 * 默认配置
 */
export const DEFAULT_CONFIG: PublishConfig = {
  name: "",
  publisher: "",
  version: "",
  platforms: [Platform.VSCode, Platform.OpenVSX],
  releaseNotes: "",
  prerelease: false,
  tag: "latest",
};

/**
 * 加载配置文件
 */
export function loadConfig(cwd: string = process.cwd()): PublishConfig {
  const configPath = path.join(cwd, CONFIG_FILE);

  if (!fs.existsSync(configPath)) {
    throw new Error(`Configuration file not found: ${configPath}`);
  }

  const content = fs.readFileSync(configPath, "utf-8");
  const config = JSON.parse(content);

  return { ...DEFAULT_CONFIG, ...config };
}

/**
 * 保存配置文件
 */
export function saveConfig(
  config: PublishConfig,
  cwd: string = process.cwd()
): void {
  const configPath = path.join(cwd, CONFIG_FILE);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}

/**
 * 从 package.json 加载配置
 */
export function loadConfigFromPackageJson(cwd: string = process.cwd()): PublishConfig {
  const packagePath = path.join(cwd, "package.json");

  if (!fs.existsSync(packagePath)) {
    throw new Error(`package.json not found: ${packagePath}`);
  }

  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf-8"));

  return {
    name: packageJson.name,
    publisher: packageJson.author || "",
    version: packageJson.version,
    platforms: packageJson.marketplace?.platforms || [Platform.VSCode],
    releaseNotes: packageJson.marketplace?.releaseNotes,
    prerelease: packageJson.marketplace?.prerelease || false,
    tag: packageJson.marketplace?.tag || "latest",
  };
}