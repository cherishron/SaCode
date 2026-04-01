#!/usr/bin/env node

/**
 * SaCode 发布脚本
 * 
 * 功能：
 * - 版本号管理
 * - Changelog 生成
 * - Git 标签创建
 * - NPM 发布
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

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
  bold: "\x1b[1m",
};

function log(message, color = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function exec(command, silent = false) {
  if (!silent) {
    log(`> ${command}`, "cyan");
  }
  try {
    return execSync(command, {
      stdio: silent ? "pipe" : "inherit",
      cwd: rootDir,
      encoding: "utf-8",
    });
  } catch (error) {
    if (!silent) {
      log(`Command failed: ${command}`, "red");
    }
    throw error;
  }
}

function execSilent(command) {
  try {
    return execSync(command, {
      cwd: rootDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}

async function question(prompt, defaultValue = "") {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    const displayPrompt = defaultValue
      ? `${prompt} (${defaultValue}): `
      : `${prompt}: `;
    rl.question(displayPrompt, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue);
    });
  });
}

/**
 * 获取当前版本
 */
function getCurrentVersion() {
  const pkgPath = join(rootDir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  return pkg.version;
}

/**
 * 更新版本号
 */
function updateVersion(newVersion) {
  const pkgPath = join(rootDir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  pkg.version = newVersion;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  log(`Updated version to ${newVersion}`, "green");
}

/**
 * 检查工作区状态
 */
function checkWorkingDirectory() {
  log("\n🔍 Checking working directory...", "yellow");

  const status = execSilent("git status --porcelain");
  if (status) {
    log("⚠️ You have uncommitted changes:", "yellow");
    console.log(status);
    return false;
  }

  log("✅ Working directory is clean", "green");
  return true;
}

/**
 * 运行测试
 */
function runTests() {
  log("\n🧪 Running tests...", "yellow");

  try {
    exec("pnpm test");
    log("✅ Tests passed", "green");
    return true;
  } catch {
    log("❌ Tests failed", "red");
    return false;
  }
}

/**
 * 构建
 */
function build() {
  log("\n🔨 Building project...", "yellow");
  exec("pnpm build");
  log("✅ Build completed", "green");
}

/**
 * 创建 Git 标签
 */
function createGitTag(version) {
  log(`\n🏷️ Creating git tag v${version}...`, "yellow");

  exec(`git tag -a v${version} -m "Release v${version}"`);
  log(`✅ Created tag v${version}`, "green");
}

/**
 * 推送标签
 */
function pushTag(version) {
  log(`\n📤 Pushing tag v${version}...`, "yellow");
  exec(`git push origin v${version}`);
  log("✅ Tag pushed", "green");
}

/**
 * 生成 Changelog
 */
function generateChangelog(version) {
  log("\n📝 Generating changelog...", "yellow");

  // 获取上一个标签
  const lastTag = execSilent("git describe --tags --abbrev=0 HEAD~1");

  // 获取提交记录
  const range = lastTag ? `${lastTag}..HEAD` : "HEAD";
  const commits = execSilent(
    `git log ${range} --pretty=format:"- %s (%h)" --no-merges`
  );

  const changelogPath = join(rootDir, "docs", "CHANGELOG.md");
  let existingChangelog = "";

  if (existsSync(changelogPath)) {
    existingChangelog = readFileSync(changelogPath, "utf-8");
  }

  const date = new Date().toISOString().split("T")[0];
  const newEntry = `## v${version} (${date})\n\n${commits}\n\n`;

  writeFileSync(changelogPath, newEntry + existingChangelog);
  log("✅ Changelog updated", "green");
}

/**
 * 计算新版本号
 */
function bumpVersion(current, type) {
  const parts = current.split(".").map(Number);

  switch (type) {
    case "major":
      return `${parts[0] + 1}.0.0`;
    case "minor":
      return `${parts[0]}.${parts[1] + 1}.0`;
    case "patch":
      return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
    default:
      return current;
  }
}

/**
 * 主函数
 */
async function main() {
  const args = process.argv.slice(2);

  log("\n🚀 SaCode Release Script", "blue");
  log("=========================\n", "blue");

  const currentVersion = getCurrentVersion();
  log(`Current version: ${currentVersion}`, "cyan");

  // 确定版本类型
  let versionType = args[0];
  if (!versionType) {
    versionType = await question(
      "Version type (major/minor/patch)?",
      "patch"
    );
  }

  if (!["major", "minor", "patch"].includes(versionType)) {
    log("Invalid version type. Use: major, minor, or patch", "red");
    process.exit(1);
  }

  const newVersion = bumpVersion(currentVersion, versionType);
  log(`New version: ${newVersion}`, "cyan");

  // 确认发布
  const confirm = await question("Continue with release? (y/n)", "y");
  if (confirm.toLowerCase() !== "y") {
    log("Release cancelled", "yellow");
    process.exit(0);
  }

  try {
    // 检查工作区
    if (!checkWorkingDirectory()) {
      const force = await question("Continue anyway? (y/n)", "n");
      if (force.toLowerCase() !== "y") {
        process.exit(1);
      }
    }

    // 运行测试
    const skipTests = args.includes("--skip-tests");
    if (!skipTests && !runTests()) {
      process.exit(1);
    }

    // 构建
    build();

    // 更新版本
    updateVersion(newVersion);

    // 生成 Changelog
    generateChangelog(newVersion);

    // Git 提交
    exec(`git add -A`);
    exec(`git commit -m "chore: release v${newVersion}"`);

    // 创建标签
    createGitTag(newVersion);

    // 推送
    const skipPush = args.includes("--skip-push");
    if (!skipPush) {
      exec("git push origin main");
      pushTag(newVersion);
    }

    log("\n🎉 Release completed successfully!", "green");
    log(`Version: v${newVersion}`, "cyan");

    if (skipPush) {
      log("\n⚠️ Remember to push manually:", "yellow");
      log("  git push origin main", "cyan");
      log(`  git push origin v${newVersion}`, "cyan");
    }

    process.exit(0);
  } catch (error) {
    log("\n❌ Release failed!", "red");
    console.error(error);
    process.exit(1);
  }
}

main();
