# 安全设计

> SACODE Skills 生态系统安全设计文档

## 概述

本文档描述 SACODE Skills 生态系统的安全架构，包括路径遍历防护、URL 注入防护、文件大小限制等安全措施。

## 安全架构

```
┌─────────────────────────────────────────────────────────────┐
│                      Skills 生态系统                         │
├─────────────────────────────────────────────────────────────┤
│  SkillRegistry (注册表)                                      │
│  ├── URL 验证 (validateSlug, validateVersion)               │
│  ├── URL 安全构建 (buildUrl)                                 │
│  ├── LRU 缓存 (防止内存溢出)                                  │
│  └── 重试机制 (指数退避)                                      │
├─────────────────────────────────────────────────────────────┤
│  SkillInstaller (安装器)                                     │
│  ├── 路径遍历防护 (validateFilePath)                         │
│  ├── 文件大小限制 (maxFileSize, maxTotalSize)                │
│  ├── 文件数量限制 (maxFileCount)                             │
│  ├── 扩展名白名单 (allowedExtensions)                        │
│  └── 校验和验证 (SHA256)                                     │
└─────────────────────────────────────────────────────────────┘
```

## 安全措施

### 1. 路径遍历防护

防止恶意技能包通过 `..` 等路径访问系统文件：

```typescript
// packages/core/src/skills/installer.ts
private validateFilePath(filePath: string, targetDir: string): string {
  const normalizedPath = path.normalize(filePath);
  
  // 禁止绝对路径
  if (path.isAbsolute(normalizedPath)) {
    throw new SecurityError(`Absolute path not allowed: ${filePath}`);
  }
  
  // 检测路径遍历
  if (normalizedPath.startsWith("..") || normalizedPath.includes(path.sep + "..")) {
    throw new SecurityError(`Path traversal detected: ${filePath}`);
  }
  
  // 验证最终路径在目标目录内
  const fullPath = path.resolve(targetDir, normalizedPath);
  const resolvedTarget = path.resolve(targetDir);
  if (!fullPath.startsWith(resolvedTarget + path.sep) && fullPath !== resolvedTarget) {
    throw new SecurityError(`Path escapes target directory: ${filePath}`);
  }
  
  return fullPath;
}
```

**防护效果**：
- ❌ `../../../etc/passwd` → SecurityError
- ❌ `/etc/passwd` → SecurityError
- ❌ `skills/../../../secret` → SecurityError
- ✅ `skills/my-skill/index.md` → 允许

### 2. URL 注入防护

防止通过恶意 slug 或版本号进行 SSRF 攻击：

```typescript
// packages/core/src/skills/registry.ts
private validateSlug(slug: string): string {
  // 长度限制
  if (slug.length > 128) {
    throw new SecurityError(`Slug too long: ${slug.length} characters`);
  }
  
  // 格式验证：只允许字母、数字、下划线、连字符、斜杠
  const validPattern = /^[a-zA-Z0-9_/-]+$/;
  if (!validPattern.test(slug)) {
    throw new SecurityError(`Invalid slug format: ${slug}`);
  }
  
  // 额外检查
  if (slug.includes("..") || slug.startsWith("/") || slug.endsWith("/")) {
    throw new SecurityError(`Invalid slug: ${slug}`);
  }
  
  return slug;
}

private validateVersion(version: string): string {
  // Semver 格式验证
  const semverPattern = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?(\+[a-zA-Z0-9.]+)?$/;
  if (!semverPattern.test(version)) {
    throw new SecurityError(`Invalid version format: ${version}`);
  }
  return version;
}

// 安全构建 URL
private buildUrl(path: string): string {
  const baseUrl = new URL(this.config.registryUrl);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return new URL(normalizedPath, baseUrl).toString();
}
```

**防护效果**：
- ❌ `../admin` → SecurityError
- ❌ `skill;rm -rf /` → SecurityError
- ❌ `skill@example.com` → SecurityError
- ❌ `http://evil.com/` → SecurityError
- ✅ `my-skill` → 允许
- ✅ `org/my-skill` → 允许

### 3. 文件大小限制

防止恶意大文件导致内存溢出或磁盘耗尽：

```typescript
// packages/core/src/skills/installer.ts
export interface SkillInstallerConfig {
  skillsDir: string;
  registry?: SkillRegistry;
  maxFileSize: number;      // 单文件最大 1MB
  maxTotalSize: number;     // 总大小最大 10MB
  maxFileCount: number;     // 文件数量最大 100
  allowedExtensions: string[];  // 扩展名白名单
}

private validateFiles(files: Record<string, string>): void {
  // 检查文件数量
  const fileCount = Object.keys(files).length;
  if (fileCount > this.config.maxFileCount) {
    throw new SecurityError(
      `Too many files: ${fileCount} > ${this.config.maxFileCount}`
    );
  }
  
  let totalSize = 0;
  
  for (const [filePath, content] of Object.entries(files)) {
    const fileSize = Buffer.byteLength(content, "utf-8");
    
    // 检查单个文件大小
    if (fileSize > this.config.maxFileSize) {
      throw new SecurityError(
        `File too large: ${filePath} (${fileSize} bytes)`
      );
    }
    
    // 检查扩展名
    const ext = path.extname(filePath).toLowerCase();
    if (!this.config.allowedExtensions.includes(ext)) {
      throw new SecurityError(`File extension not allowed: ${ext}`);
    }
    
    totalSize += fileSize;
  }
  
  // 检查总大小
  if (totalSize > this.config.maxTotalSize) {
    throw new SecurityError(`Total size too large: ${totalSize} bytes`);
  }
}
```

**默认限制**：

| 限制项 | 默认值 | 说明 |
|--------|--------|------|
| maxFileSize | 1,048,576 (1MB) | 单文件最大大小 |
| maxTotalSize | 10,485,760 (10MB) | 总文件大小 |
| maxFileCount | 100 | 最大文件数量 |

### 4. 扩展名白名单

只允许安全的文件类型：

```typescript
const DEFAULT_ALLOWED_EXTENSIONS = [
  ".md",      // Markdown 文档
  ".ts",      // TypeScript 源码
  ".js",      // JavaScript 源码
  ".json",    // JSON 配置
  ".yaml",    // YAML 配置
  ".yml",     // YAML 配置
  ".txt",     // 文本文件
];
```

**禁止的文件类型**：
- ❌ `.exe`, `.bat`, `.sh` - 可执行文件
- ❌ `.dll`, `.so` - 动态链接库
- ❌ `.env` - 环境变量文件
- ❌ `.pem`, `.key` - 密钥文件

### 5. LRU 缓存

限制缓存大小，防止内存溢出：

```typescript
// packages/core/src/skills/registry.ts
class LRUCache<K, V> {
  private cache: Map<K, V>;
  private maxSize: number = 50;  // 最大 50 条缓存

  get(key: K): V | undefined {
    if (!this.cache.has(key)) return undefined;
    // 移动到末尾（最近使用）
    const value = this.cache.get(key)!;
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // 淘汰最久未使用
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
    this.cache.set(key, value);
  }
}
```

### 6. 重试机制

网络请求的指数退避重试：

```typescript
// packages/core/src/skills/registry.ts
private async fetchWithRetry(url: string, retries = 3): Promise<Response> {
  let lastError: Error | null = null;
  
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(this.config.timeout),
      });
      
      // 5xx 错误可重试
      if (response.status >= 500 && i < retries - 1) {
        await this.delay(1000 * Math.pow(2, i));  // 指数退避
        continue;
      }
      
      return response;
    } catch (error) {
      lastError = error as Error;
      if (i < retries - 1) {
        await this.delay(1000 * Math.pow(2, i));
      }
    }
  }
  
  throw new NetworkError(lastError?.message || "Network error", undefined, true);
}
```

### 7. 校验和验证

安装后验证文件完整性：

```typescript
// packages/core/src/skills/installer.ts
private async calculateChecksum(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath, "utf-8");
  return crypto.createHash("sha256").update(content).digest("hex");
}

async install(skillId: string): Promise<SkillInstallResult> {
  // ...安装文件
  
  // 计算并存储校验和
  const checksum = await this.calculateChecksum(skillDir);
  const manifestPath = path.join(skillDir, ".checksum");
  await fs.writeFile(manifestPath, JSON.stringify({ checksum, installedAt: new Date().toISOString() }));
  
  return { skillId, path: skillDir, checksum };
}
```

## 错误类型

### SecurityError

安全相关错误，表示请求被拒绝：

```typescript
export class SecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecurityError";
  }
}
```

### NetworkError

网络相关错误，包含是否可重试标志：

```typescript
export class NetworkError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = "NetworkError";
  }
}
```

## 配置选项

```typescript
// SkillRegistry 配置
interface SkillRegistryConfig {
  registryUrl: string;     // ClawHub API URL，可配置
  timeout: number;         // 请求超时时间
  retries: number;         // 重试次数
}

// SkillInstaller 配置
interface SkillInstallerConfig {
  skillsDir: string;           // 技能安装目录
  registry?: SkillRegistry;    // 注册表实例
  maxFileSize: number;         // 单文件大小限制
  maxTotalSize: number;        // 总大小限制
  maxFileCount: number;        // 文件数量限制
  allowedExtensions: string[]; // 扩展名白名单
}
```

## 安全检查清单

- [x] 路径遍历防护
- [x] URL 注入防护
- [x] 文件大小限制
- [x] 文件数量限制
- [x] 扩展名白名单
- [x] LRU 缓存限制
- [x] 重试机制
- [x] 校验和验证
- [x] 可配置 API URL
- [ ] 输入内容验证
- [ ] 权限分级

---

*最后更新：2026-03-15*
