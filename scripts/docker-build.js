#!/usr/bin/env node

/**
 * SaCode Docker 构建脚本
 * 
 * 功能：
 * - 构建 Docker 镜像
 * - 推送到镜像仓库
 * - 支持多平台构建
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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
  log(`> ${command}`, "cyan");
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

/**
 * 获取当前 Git 版本信息
 */
function getVersionInfo() {
  const gitTag = execSilent("git describe --tags --abbrev=0 2>/dev/null");
  const gitCommit = execSilent("git rev-parse --short HEAD");
  const gitBranch = execSilent("git rev-parse --abbrev-ref HEAD");

  return {
    tag: gitTag || "v0.0.0",
    commit: gitCommit || "unknown",
    branch: gitBranch || "main",
  };
}

/**
 * 构建单个镜像
 */
function buildImage(dockerfile, imageName, tag, options = {}) {
  const { platform, noCache = false, buildArgs = {} } = options;

  log(`\n🔨 Building ${imageName}:${tag}...`, "yellow");

  const parts = [
    "docker build",
    `-f ${dockerfile}`,
    `-t ${imageName}:${tag}`,
  ];

  if (platform) {
    parts.push(`--platform ${platform}`);
  }

  if (noCache) {
    parts.push("--no-cache");
  }

  // 添加构建参数
  const versionInfo = getVersionInfo();
  buildArgs.VERSION = versionInfo.tag;
  buildArgs.COMMIT = versionInfo.commit;
  buildArgs.BRANCH = versionInfo.branch;

  for (const [key, value] of Object.entries(buildArgs)) {
    parts.push(`--build-arg ${key}=${value}`);
  }

  parts.push(".");

  exec(parts.join(" "));
  log(`✅ Built ${imageName}:${tag}`, "green");
}

/**
 * 构建所有镜像
 */
function buildAll(tag, options = {}) {
  log("\n🏗️ Building all Docker images...", "blue");

  const dockerDir = join(rootDir, "docker");

  // 检查 Dockerfile 是否存在
  const dockerfiles = [
    { file: "api.Dockerfile", name: "sacode-api" },
    { file: "web.Dockerfile", name: "sacode-web" },
    { file: "agent.Dockerfile", name: "sacode-agent" },
  ];

  for (const { file, name } of dockerfiles) {
    const dockerfilePath = join(dockerDir, file);
    if (existsSync(dockerfilePath)) {
      buildImage(dockerfilePath, name, tag, options);
    } else {
      log(`⚠️ Dockerfile not found: ${file}`, "yellow");
    }
  }
}

/**
 * 推送镜像到仓库
 */
function pushImage(imageName, tag, registry) {
  log(`\n📤 Pushing ${imageName}:${tag}...`, "yellow");

  if (registry) {
    // 标记镜像
    const fullImageName = `${registry}/${imageName}:${tag}`;
    exec(`docker tag ${imageName}:${tag} ${fullImageName}`);
    exec(`docker push ${fullImageName}`);
    log(`✅ Pushed ${fullImageName}`, "green");
  } else {
    exec(`docker push ${imageName}:${tag}`);
    log(`✅ Pushed ${imageName}:${tag}`, "green");
  }
}

/**
 * 推送所有镜像
 */
function pushAll(tag, registry) {
  log("\n📤 Pushing all Docker images...", "blue");

  const images = ["sacode-api", "sacode-web", "sacode-agent"];

  for (const imageName of images) {
    try {
      pushImage(imageName, tag, registry);
    } catch {
      log(`⚠️ Failed to push ${imageName}`, "yellow");
    }
  }
}

/**
 * 清理悬空镜像
 */
function pruneImages() {
  log("\n🧹 Pruning dangling images...", "yellow");
  exec("docker image prune -f");
  log("✅ Prune completed", "green");
}

/**
 * 显示帮助
 */
function showHelp() {
  console.log(`
${colors.blue}SaCode Docker Build Script${colors.reset}

Usage:
  node scripts/docker-build.js [command] [options]

Commands:
  build [tag]         Build all images (default: latest)
  push [tag] [registry] Push all images to registry
  prune               Remove dangling images
  all [tag] [registry] Build and push all images

Options:
  --no-cache          Build without cache
  --platform <plat>   Build for specific platform (e.g., linux/amd64)
  --help              Show this help message

Examples:
  node scripts/docker-build.js build v1.0.0
  node scripts/docker-build.js build latest --no-cache
  node scripts/docker-build.js push v1.0.0 registry.example.com
  node scripts/docker-build.js all v1.0.0
`);
}

/**
 * 主函数
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "build";

  if (command === "--help" || command === "-h") {
    showHelp();
    process.exit(0);
  }

  log("\n🐳 SaCode Docker Build Script", "blue");
  log("==============================\n", "blue");

  const versionInfo = getVersionInfo();
  log(`Version: ${versionInfo.tag}`, "cyan");
  log(`Commit:  ${versionInfo.commit}`, "cyan");
  log(`Branch:  ${versionInfo.branch}`, "cyan");

  try {
    switch (command) {
      case "build": {
        const tag = args[1] || "latest";
        const noCache = args.includes("--no-cache");
        const platformIndex = args.indexOf("--platform");
        const platform = platformIndex > -1 ? args[platformIndex + 1] : undefined;

        buildAll(tag, { noCache, platform });
        break;
      }

      case "push": {
        const tag = args[1] || "latest";
        const registry = args[2];
        pushAll(tag, registry);
        break;
      }

      case "prune":
        pruneImages();
        break;

      case "all": {
        const tag = args[1] || "latest";
        const registry = args[2];
        buildAll(tag);
        pushAll(tag, registry);
        break;
      }

      default:
        log(`Unknown command: ${command}`, "red");
        showHelp();
        process.exit(1);
    }

    log("\n🎉 Docker build script completed!", "green");
    process.exit(0);
  } catch (error) {
    log("\n❌ Docker build script failed!", "red");
    console.error(error);
    process.exit(1);
  }
}

main();
