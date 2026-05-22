# SaCode 版本变更记录

所有重要变更都会记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

---

## [0.1.8] - 2026-05-22

### 修复

- TUI 键绑定调整
  - Ctrl+Q 退出（替代 Esc）
  - Esc 清空当前输入（取消单次对话）

---

## [0.1.7] - 2026-05-22

### 变更

- TUI 重构为聊天式交互界面
  - 消息区域显示时间戳 + 用户/SaCode 标识
  - 底部输入框，placeholder 提示输入任务
  - 支持滚动浏览历史消息

---

## [0.1.6] - 2026-05-22

### 新增

- 平台清单机制 (`platforms/manifest.json`)
  - 记录发布版本和包含的二进制文件
  - 发布检查脚本强制验证清单一致性
  - 防止"新壳旧核"问题

- 交叉编译支持
  - Linux 环境可直接编译 Windows 二进制
  - `.cargo/config.toml` 配置 mingw-w64 linker

- 文档分类
  - `docs/release/RELEASE.md` - 发布流程文档
  - `docs/build/CROSS_COMPILE.md` - 交叉编译指南

### 变更

- CLI 默认行为改为进入 TUI
  - `sacode` 无参数直接启动终端 UI
  - 保留 `sacode tui` 显式入口
  - 保留 `sacode repl` REPL 模式

- 发布检查增强
  - 新增 manifest.json 校验
  - 新增版本一致性强制检查
  - CI 流程写入 manifest 再发布

- npm 包内容更新
  - 包含 `platforms/manifest.json`
  - Linux 二进制大小: 9.4MB
  - Windows 二进制大小: 45.2MB

### 修复

- 修复 Windows 用户安装后仍是旧版本的 bug
  - 根因: npm 包包含旧 Windows 二进制
  - 解决: 重新构建并验证 manifest 机制

---

## [0.1.5] - 2026-05-22

### 新增

- TUI 模块提取为共享代码
  - `interfaces/cli/src/tui.rs`
  - `sacode` 主入口可调用 TUI

### 变更

- 文档更新入口行为说明
  - `README.md`
  - `docs/API.md`
  - `npm-package/README.md`

### 问题

- 发布后发现 Windows 二进制仍是旧版本
- 缺少平台清单校验机制

---

## [0.1.4] - 之前版本

历史版本记录待补充。

### 已实现功能

- 工作区结构: `kernel/`, `runtime/`, `interfaces/cli/`
- Kernel: agents, events, schema, supervisor, reviews, checkpoints
- Runtime: tools, provider client, plugin host, daemon, sandbox
- CLI: run, profile, plugin, init, repl, checkpoint 子命令
- FFI: `cdylib` 导出, C header
- SSE daemon: 任务状态跟踪, 事件流
- npm 发布: `@cherishron/sacode`
- CI: test.yml, npm-test.yml, release.yml

---

## 版本规划

### 近期

- 真实 LLM provider streaming
- 完善审批流 UI
- Checkpoint 持久化
- 测试覆盖提升

### 中期

- macOS 支持
- 多语言 SDK (Python, Go)
- Web UI

### 远期

- 多 agent 协作
- IDE 插件
- 云端部署

---

## 获取最新版本

```bash
npm install -g @cherishron/sacode
sacode --version
```

或查看 npm registry:

```bash
npm view @cherishron/sacode version
```