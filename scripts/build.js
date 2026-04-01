#!/usr/bin/env node

/**
 * SaCode 构建脚本
 * 
 * 功能：
 * - 清理构建产物
 * - 构建所有包
 * - 生成类型声明
 * - 验证构建结果
 */

import { execSync } from "node:child_process";
import { existsSync, rmSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

// 颜色输出
const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

function log(message, color = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function exec(command, options = {}) {
  log(`\n> ${command}`, "cyan");
  try {
    return execSync(command, {
      stdio: "inherit",
      cwd: rootDir,
      ...options,
    });
  } catch (error) {
    log(`Command failed: ${command}`, "red");
    throw error;
  }
}

/**
 * 清理所有构建产物
 */
function clean() {
  log("\n🧹 Cleaning build artifacts...", "yellow");

  const packagesDir = join(rootDir, "packages");
  const packages = readdirSync(packagesDir).filter((name) => {
    const pkgPath = join(packagesDir, name);
    return statSync(pkgPath).isDirectory();
  });

  for (const pkg of packages) {
    const distDir = join(packagesDir, pkg, "dist");
    if (existsSync(distDir)) {
      rmSync(distDir, { recursive: true, force: true });
      log(`  Removed: packages/${pkg}/dist`, "green");
    }

    // 清理 tsbuildinfo
    const tsbuildinfo = join(packagesDir, pkg, "dist", ".tsbuildinfo");
    if (existsSync(tsbuildinfo)) {
      rmSync(tsbuildinfo, { force: true });
    }
  }

  // 清理根目录 node_modules/.cache
  const cacheDir = join(rootDir, "node_modules", ".cache");
  if (existsSync(cacheDir)) {
    rmSync(cacheDir, { recursive: true, force: true });
    log("  Removed: node_modules/.cache", "green");
  }

  log("✅ Clean completed", "green");
}

/**
 * 构建所有包
 */
function build() {
  log("\n🔨 Building all packages...", "yellow");

  // 使用 pnpm 递归构建
  exec("pnpm --filter \"./packages/*\" run build");

  log("✅ Build completed", "green");
}

/**
 * 类型检查
 */
function typecheck() {
  log("\n🔍 Running type check...", "yellow");

  try {
    exec("npx tsc --noEmit");
    log("✅ Type check passed", "green");
  } catch {
    log("⚠️ Type check failed (non-blocking)", "yellow");
  }
}

/**
 * 验证构建结果
 */
function validate() {
  log("\n✅ Validating build output...", "yellow");

  const requiredPackages = [
    "core",
    "adapters",
    "api",
    "auth",
    "database",
    "gateway",
    "capabilities",
    "container",
    "cli",
    "types",
  ];

  let hasErrors = false;

  for (const pkg of requiredPackages) {
    const distDir = join(rootDir, "packages", pkg, "dist");
    const indexFile = join(distDir, "index.js");
    const typesFile = join(distDir, "index.d.ts");

    if (!existsSync(distDir)) {
      log(`  ❌ Missing dist: packages/${pkg}`, "red");
      hasErrors = true;
      continue;
    }

    if (!existsSync(indexFile)) {
      log(`  ⚠️ Missing index.js: packages/${pkg}`, "yellow");
    }

    if (!existsSync(typesFile)) {
      log(`  ⚠️ Missing index.d.ts: packages/${pkg}`, "yellow");
    }

    if (existsSync(indexFile) && existsSync(typesFile)) {
      log(`  ✅ packages/${pkg}`, "green");
    }
  }

  if (hasErrors) {
    throw new Error("Build validation failed");
  }

  log("✅ Validation completed", "green");
}

/**
 * 主函数
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "all";

  log("\n📦 SaCode Build Script", "blue");
  log("========================\n", "blue");

  try {
    switch (command) {
      case "clean":
        clean();
        break;
      case "build":
        build();
        break;
      case "typecheck":
        typecheck();
        break;
      case "validate":
        validate();
        break;
      case "all":
      default:
        clean();
        build();
        typecheck();
        validate();
        break;
    }

    log("\n🎉 Build script completed successfully!", "green");
    process.exit(0);
  } catch (error) {
    log("\n❌ Build script failed!", "red");
    console.error(error);
    process.exit(1);
  }
}

main();
