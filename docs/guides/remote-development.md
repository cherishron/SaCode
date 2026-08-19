# 远程开发使用指南

## 概述

SaCode 支持在远程环境（SSH 服务器、云 VM、容器）中使用。本文档说明如何配置和连接远程开发环境。

## 方式一：SSH 直接连接

### 前置条件

- 远程服务器已安装 SaCode（见 [安装指南](../reference/API.md)）
- 本地拥有 SSH 客户端
- 远程服务器支持 UTF-8 终端

### 连接步骤

1. **SSH 登录远程服务器**
   ```bash
   ssh user@remote-server
   ```

2. **进入项目目录**
   ```bash
   cd /path/to/project
   ```

3. **启动 SaCode TUI**
   ```bash
   sacode
   ```

### 终端兼容性

| 终端 | 兼容性 | 说明 |
|------|--------|------|
| iTerm2 (macOS) | ✅ 完全支持 | Unicode、颜色、Ctrl 快捷键正常 |
| Windows Terminal | ✅ 完全支持 | 建议使用 PowerShell 7+ |
| VS Code 内置终端 | ✅ 完全支持 | 通过 Remote SSH 连接 |
| tmux | ✅ 完全支持 | 建议使用 UTF-8 locale |
| screen | ✅ 基本支持 | 需设置 `defutf8 on` |
| PuTTY | ⚠️ 部分支持 | 需要设置 UTF-8 |
| CMD.exe | ⚠️ 部分支持 | 建议使用 Windows Terminal |

> **注意**：Alt+M 快捷键在部分终端中可能被捕获。如遇此问题，可使用 `/mode` 命令代替。

## 方式二：通过 Docker 容器

### 前置条件

- 本地已安装 Docker
- 已构建或拉取 SaCode 镜像

### 使用步骤

1. **拉取或构建镜像**
   ```bash
   docker pull your-registry/sacode:latest
   ```

2. **运行容器**
   ```bash
   docker run -it --rm \
     -v $(pwd):/workspace \
     -v $HOME/.sacode:/root/.sacode \
     -w /workspace \
     your-registry/sacode:latest
   ```

3. **在容器内启动 SaCode**
   ```bash
   sacode
   ```

## 方式三：通过 VS Code Remote SSH

1. 在 VS Code 中安装 Remote SSH 扩展
2. 按 `F1` → `Remote-SSH: Connect to Host...`
3. 连接到远程服务器
4. 在 VS Code 内置终端中运行 `sacode`
5. 推荐配置：
   ```json
   {
     "terminal.integrated.fontFamily": "MesloLGS NF, Cascadia Code, monospace",
     "terminal.integrated.gpuAcceleration": "off"
   }
   ```

## 环境变量配置

远程环境中可设置以下环境变量：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `SACODE_HOME` | `~/.sacode` | SaCode 配置目录 |
| `SACODE_CACHE` | `~/.cache/sacode` | 缓存目录 |
| `SACODE_LOG` | 同 `SACODE_HOME` | 日志目录 |
| `SACODE_DATA` | `~/.local/share/sacode` | 数据目录 |

## 性能优化

### 大项目远程开发

- 使用 `--workdir` 指定工作目录
- 避免在远程上过多文件监控
- 使用 `/compress` 定期压缩上下文

### 网络延迟优化

- 使用 Mosh 替代 SSH 减少延迟
- 确保 `LC_ALL=en_US.UTF-8` 环境变量
- 使用 tmux 保持会话不断开

## 常见问题

### Q: 终端显示乱码
确保远程终端 locale 为 UTF-8：
```bash
locale -a | grep -i utf
export LANG=en_US.UTF-8
```

### Q: 快捷键无法使用
某些终端会捕获 Alt 组合键。替代方案：
- `Alt+M` → `/mode`
- `Ctrl+A` → 手动输入优化请求
- `Ctrl+S` → `/fold all` 或 `/expand all`

### Q: 连接断开后恢复
使用 tmux 保持会话：
```bash
tmux new -s sacode
sacode
# 断开后重新连接
tmux attach -t sacode
```

### Q: 文件权限问题
确保远程用户对项目目录有读写权限，`.sacode` 目录自动创建。如遇到权限问题：
```bash
chmod -R u+rw .sacode
```