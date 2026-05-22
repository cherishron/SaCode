# SaCode 发布流程

## 发布方式

SaCode 支持两种发布方式：

1. **GitHub Actions 自动发布**（推荐）
2. **本地手动发布**

---

## 1. GitHub Actions 自动发布

### 前置条件

- 仓库已配置 `NPM_TOKEN` secret
- 有 push tag 权限

### 步骤

```bash
# 确保代码已提交
git status

# 创建版本 tag
git tag v0.1.6

# 推送 tag 到远端
git push origin v0.1.6
```

### 自动流程

触发 `.github/workflows/release.yml`：

1. **构建阶段**（并行）
   - Linux: `ubuntu-latest` 构建 `x86_64-unknown-linux-gnu`
   - Windows: `windows-latest` 构建 `x86_64-pc-windows-msvc`

2. **准备二进制**
   - `sacode-linux-x64`
   - `sacode-win32-x64.exe`

3. **写入平台清单**
   - 生成 `npm-package/platforms/manifest.json`

4. **发布检查**
   - `node scripts/check-release.js --strict-platforms`

5. **npm 发布**
   - 发布 `@cherishron/sacode@<version>`

6. **GitHub Release**
   - 创建 release，附带二进制文件

---

## 2. 本地手动发布

### 2.1 交叉编译

Linux 环境可以交叉编译 Windows 二进制：

```bash
# 安装 mingw-w64
apt-get install mingw-w64

# 配置 cargo linker
# .cargo/config.toml 已包含配置

# 编译 Linux 目标
cargo build --release --target x86_64-unknown-linux-gnu

# 编译 Windows 目标
cargo build --release --target x86_64-pc-windows-gnu
```

### 2.2 准备 npm 包

```bash
# 复制二进制到 npm 包
cp target/release/sacode npm-package/platforms/sacode-linux-x64
cp target/x86_64-pc-windows-gnu/release/sacode.exe npm-package/platforms/sacode-win32-x64.exe

# 设置执行权限
chmod +x npm-package/platforms/sacode-linux-x64
```

### 2.3 同步版本

```bash
# 同步项目版本到 0.1.x
node scripts/sync-version.js 0.1.7

# 写入平台清单
node scripts/write-platform-manifest.js 0.1.7
```

### 2.4 发布检查

```bash
# 严格检查（验证 manifest 和平台文件）
node scripts/check-release.js --strict-platforms
```

### 2.5 发布

```bash
cd npm-package
npm pack   # 预览包内容
npm publish
```

---

## 发布检查项

`scripts/check-release.js` 会验证：

| 检查项 | 说明 |
|--------|------|
| npm 包名 | 必须为 `@cherishron/sacode` |
| 版本一致性 | npm、Cargo、manifest 版本必须一致 |
| bin 配置 | `bin.sacode` 必须指向 `./bin/sacode.js` |
| install script | 必须为 `node bin/install.js` |
| README 安装命令 | 必须包含正确的 npm install 命令 |
| README 平台列表 | 必须列出 Linux x64 和 Windows x64 |
| README 不含 macOS | 当前不支持 macOS，不能误导用户 |
| 启动器映射 | `bin/sacode.js` 的平台映射必须正确 |
| 安装脚本映射 | `bin/install.js` 的平台映射必须正确 |
| manifest 存在 | `platforms/manifest.json` 必须存在 |
| manifest 版本 | 必须与 Cargo 版本一致 |
| manifest 文件列表 | 必须包含正确的平台二进制文件名 |

---

## 平台清单 (manifest.json)

### 格式

```json
{
  "version": "0.1.6",
  "generatedAt": "2026-05-22T08:00:00Z",
  "files": [
    "sacode-linux-x64",
    "sacode-win32-x64.exe"
  ]
}
```

### 作用

- 记录发布时的版本号
- 记录包含的平台二进制文件
- 发布检查时验证版本一致性
- 防止"新壳旧核"问题（npm 包外壳新版本，但二进制是旧版本）

---

## 版本号规则

遵循 semver：

- `MAJOR.MINOR.PATCH`
- MAJOR: 不兼容的 API 变更
- MINOR: 新功能，向后兼容
- PATCH: bug 修复，向后兼容

---

## 当前支持平台

| 平台 | 架构 | 二进制文件名 |
|------|------|-------------|
| Linux | x64 | `sacode-linux-x64` |
| Windows | x64 | `sacode-win32-x64.exe` |

macOS 支持计划中，暂未包含在发布包内。

---

## 常见问题

### Q: npm 发布失败，提示版本已存在

```bash
npm error 403 You cannot publish over the previously published versions
```

**原因**: npm 不允许覆盖已发布的版本

**解决**: 提升版本号后再发布

```bash
node scripts/sync-version.js 0.1.7
node scripts/write-platform-manifest.js 0.1.7
npm publish
```

### Q: 发布检查失败，提示 manifest 缺失

```bash
release check failed: platform manifest is missing
```

**原因**: 未生成 `platforms/manifest.json`

**解决**: 运行清单生成脚本

```bash
node scripts/write-platform-manifest.js <version>
```

### Q: 发布检查失败，版本不一致

```bash
release check failed: npm version 0.1.5 does not match Cargo version 0.1.6
```

**原因**: 多处版本号未同步

**解决**: 使用版本同步脚本

```bash
node scripts/sync-version.js 0.1.6
```

### Q: Windows 用户安装后版本仍是旧版

**原因**: npm 包里的 `platforms/sacode-win32-x64.exe` 是旧二进制

**解决**: 重新构建 Windows 二进制，更新 `platforms/` 目录，重新发布

---

## 相关文件

- `.github/workflows/release.yml` - CI 发布流程
- `.github/workflows/npm-test.yml` - CI 构建测试
- `scripts/sync-version.js` - 版本同步脚本
- `scripts/write-platform-manifest.js` - 清单生成脚本
- `scripts/check-release.js` - 发布检查脚本
- `npm-package/platforms/manifest.json` - 平台清单
- `.cargo/config.toml` - 交叉编译 linker 配置