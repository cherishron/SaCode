# Skills 系统

> SaClaw Skills 生态系统文档 - 基于 ClawHub 协议的技能管理

## 概述

Skills 是 SaClaw 的插件化技能系统，支持从 ClawHub 注册表安装和管理技能包。

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Skills 生态系统                           │
├─────────────────────────────────────────────────────────────┤
│  SkillRegistry (注册表客户端)                                │
│  ├── list() - 列出可用技能                                   │
│  ├── search() - 搜索技能                                     │
│  ├── get() - 获取技能详情                                    │
│  └── download() - 下载技能包                                 │
├─────────────────────────────────────────────────────────────┤
│  SkillInstaller (安装器)                                     │
│  ├── install() - 安装技能                                    │
│  ├── uninstall() - 卸载技能                                  │
│  ├── update() - 更新技能                                     │
│  └── list() - 列出已安装技能                                 │
├─────────────────────────────────────────────────────────────┤
│  SkillManager (管理器)                                       │
│  ├── load() - 加载技能                                       │
│  ├── execute() - 执行技能                                    │
│  └── validate() - 验证技能                                   │
└─────────────────────────────────────────────────────────────┘
```

## 核心 API

### SkillRegistry

注册表客户端，用于与 ClawHub API 交互：

```typescript
import { SkillRegistry } from "@saclaw/core";

const registry = new SkillRegistry({
  registryUrl: "https://api.clawhub.dev",
  timeout: 30000,
  retries: 3,
});

// 列出技能
const skills = await registry.list({ page: 1, limit: 20 });

// 搜索技能
const results = await registry.search("weather");

// 获取详情
const skill = await registry.get("weather-api");

// 下载技能包
const files = await registry.download("weather-api", "1.0.0");
```

### SkillInstaller

技能安装器，处理本地安装：

```typescript
import { SkillInstaller } from "@saclaw/core";

const installer = new SkillInstaller({
  skillsDir: "./skills",
  maxFileSize: 1024 * 1024,      // 1MB
  maxTotalSize: 10 * 1024 * 1024, // 10MB
  maxFileCount: 100,
  allowedExtensions: [".md", ".ts", ".js", ".json", ".yaml"],
});

// 安装技能
const result = await installer.install("weather-api");

// 卸载技能
await installer.uninstall("weather-api");

// 更新技能
await installer.update("weather-api");

// 列出已安装
const installed = await installer.list();
```

### SkillManager

技能管理器，加载和执行技能：

```typescript
import { SkillManager } from "@saclaw/core";

const manager = new SkillManager({ skillsDir: "./skills" });

// 加载技能
const skill = await manager.load("weather-api");

// 执行技能
const result = await manager.execute("weather-api", {
  city: "北京",
});

// 验证技能
const valid = await manager.validate("weather-api");
```

## 技能包格式

### 目录结构

```
weather-api/
├── skill.md           # 技能描述文件（必需）
├── index.ts           # 入口文件
├── config.json        # 配置文件
├── prompts/           # 提示词模板
│   └── default.md
└── examples/          # 示例文件
    └── usage.md
```

### skill.md 格式

```markdown
---
name: weather-api
version: 1.0.0
description: 天气查询技能
author: developer
tags:
  - weather
  - api
dependencies:
  - http-client
---

# Weather API Skill

获取指定城市的天气信息。

## 输入参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| city | string | 是 | 城市名称 |

## 示例

用户: 北京今天天气怎么样？
助手: [调用天气 API 获取数据]
```

### config.json 格式

```json
{
  "name": "weather-api",
  "version": "1.0.0",
  "entry": "index.ts",
  "timeout": 30000,
  "permissions": ["http", "fs.read"],
  "env": {
    "API_KEY": "required"
  }
}
```

## 安全机制

### 1. 路径遍历防护

```typescript
// 自动检测并拒绝危险路径
await installer.install("../../../etc/passwd"); // SecurityError
```

### 2. 文件大小限制

```typescript
// 默认限制
maxFileSize: 1MB      // 单文件最大 1MB
maxTotalSize: 10MB    // 总大小最大 10MB
maxFileCount: 100     // 文件数量最大 100
```

### 3. 扩展名白名单

只允许以下文件类型：
- `.md` - Markdown 文档
- `.ts` - TypeScript 源码
- `.js` - JavaScript 源码
- `.json` - JSON 配置
- `.yaml` / `.yml` - YAML 配置
- `.txt` - 文本文件

### 4. URL 注入防护

```typescript
// 自动验证 slug 格式
registry.get("weather-api");    // ✅ 有效
registry.get("../admin");       // ❌ SecurityError
registry.get("skill;rm -rf /"); // ❌ SecurityError
```

### 5. 校验和验证

安装后自动计算 SHA256 校验和，确保文件完整性：

```typescript
const result = await installer.install("weather-api");
console.log(result.checksum); // "sha256:abc123..."
```

## 错误处理

### SecurityError

安全相关错误：

```typescript
try {
  await installer.install("../../../etc/passwd");
} catch (error) {
  if (error instanceof SecurityError) {
    console.error("安全错误:", error.message);
  }
}
```

### NetworkError

网络相关错误：

```typescript
try {
  const skill = await registry.get("weather-api");
} catch (error) {
  if (error instanceof NetworkError) {
    console.error("网络错误:", error.message);
    console.error("状态码:", error.statusCode);
    console.error("可重试:", error.retryable);
  }
}
```

## 配置选项

### SkillRegistryConfig

```typescript
interface SkillRegistryConfig {
  registryUrl: string;    // ClawHub API URL
  timeout: number;        // 请求超时时间 (ms)
  retries: number;        // 重试次数
}
```

### SkillInstallerConfig

```typescript
interface SkillInstallerConfig {
  skillsDir: string;           // 技能安装目录
  registry?: SkillRegistry;    // 注册表实例
  maxFileSize: number;         // 单文件大小限制
  maxTotalSize: number;        // 总大小限制
  maxFileCount: number;        // 文件数量限制
  allowedExtensions: string[]; // 扩展名白名单
}
```

## 使用示例

### 安装技能

```typescript
import { SkillRegistry, SkillInstaller } from "@saclaw/core";

// 创建注册表客户端
const registry = new SkillRegistry({
  registryUrl: "https://api.clawhub.dev",
});

// 创建安装器
const installer = new SkillInstaller({
  skillsDir: "./skills",
  registry,
});

// 搜索技能
const results = await registry.search("weather");
console.log(`找到 ${results.length} 个技能`);

// 安装技能
const result = await installer.install("weather-api");
console.log(`安装成功: ${result.path}`);
```

### 执行技能

```typescript
import { SkillManager } from "@saclaw/core";

const manager = new SkillManager({ skillsDir: "./skills" });

// 执行技能
const result = await manager.execute("weather-api", {
  city: "北京",
});

console.log(result.output);
// 输出: 北京今天晴，温度 25°C
```

### 批量管理

```typescript
// 列出已安装技能
const installed = await installer.list();
console.log(`已安装 ${installed.length} 个技能`);

// 批量更新
for (const skill of installed) {
  if (skill.hasUpdate) {
    await installer.update(skill.id);
    console.log(`更新成功: ${skill.id}`);
  }
}

// 批量卸载
for (const skill of installed) {
  if (!skill.required) {
    await installer.uninstall(skill.id);
    console.log(`卸载成功: ${skill.id}`);
  }
}
```

## CLI 命令

```bash
# 安装技能
saclaw skill install weather-api

# 卸载技能
saclaw skill uninstall weather-api

# 更新技能
saclaw skill update weather-api

# 列出已安装
saclaw skill list

# 搜索技能
saclaw skill search weather
```

## 最佳实践

### 1. 使用类型检查

```typescript
import type { Skill, SkillInstallResult } from "@saclaw/core";

const result: SkillInstallResult = await installer.install("weather-api");
```

### 2. 错误处理

```typescript
try {
  await installer.install("weather-api");
} catch (error) {
  if (error instanceof SecurityError) {
    // 处理安全错误
  } else if (error instanceof NetworkError) {
    // 处理网络错误
  } else {
    // 处理其他错误
  }
}
```

### 3. 配置管理

```typescript
// 使用环境变量配置
const registry = new SkillRegistry({
  registryUrl: process.env.CLAWHUB_URL || "https://api.clawhub.dev",
  timeout: parseInt(process.env.CLAWHUB_TIMEOUT || "30000"),
});
```

---

*最后更新：2026-03-15*
