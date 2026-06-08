# SaCode 交叉编译指南

本文档说明如何在 Linux 环境下交叉编译 Windows 和 macOS 可执行文件，并和当前 npm 发布包的产物要求保持一致。

---

## 背景

SaCode 的 npm 包需要同时包含 Linux、Windows 和 macOS 二进制。在 Linux CI 环境中，我们可以通过 mingw-w64 工具链交叉编译 Windows 目标，通过 osxcross 工具链交叉编译 macOS 目标，无需真实的 Windows 或 macOS 机器。

---

## 前置条件

### 1. Rust Windows 目标

```bash
rustup target add x86_64-pc-windows-gnu
```

### 2. mingw-w64 工具链

```bash
# Debian/Ubuntu
apt-get install mingw-w64

# Arch Linux
pacman -S mingw-w64

# Fedora
dnf install mingw64-gcc
```

---

## Cargo 配置

`.cargo/config.toml` 需包含 linker 配置：

```toml
[target.x86_64-pc-windows-gnu]
linker = "x86_64-w64-mingw32-gcc"
ar = "x86_64-w64-mingw32-gcc-ar"
```

---

## 编译命令

### Linux 本机编译

```bash
cargo build --release --target x86_64-unknown-linux-gnu
```

输出: `target/release/sacode` 或 `target/x86_64-unknown-linux-gnu/release/sacode`

### Windows 交叉编译

```bash
cargo build --release --target x86_64-pc-windows-gnu
```

输出: `target/x86_64-pc-windows-gnu/release/sacode.exe`

---

## macOS 交叉编译

### 前置条件

#### 1. Rust macOS 目标

```bash
# Intel Mac 目标
rustup target add x86_64-apple-darwin

# Apple Silicon 目标
rustup target add aarch64-apple-darwin
```

#### 2. osxcross 工具链（可选）

```bash
# 克隆 osxcross 仓库
git clone --depth=1 --branch v1.2 https://github.com/tpoechtrager/osxcross.git
cd osxcross

# 下载 macOS SDK（需要 macOS SDK 许可）
# 这里使用系统自带的 Xcode Command Line Tools
# 或使用预编译的 SDK

# 构建工具链
sudo ./tools/gen_sdk_package.sh
sudo ./build.sh
```

#### 3. 简化方案：使用 GitHub Actions

由于 macOS 交叉编译涉及复杂的 SDK 配置，推荐直接使用 GitHub Actions 的 macOS runner：

```yaml
# .github/workflows/build-macos.yml
jobs:
  build-macos:
    runs-on: macos-14
    strategy:
      matrix:
        target: [x86_64-apple-darwin, aarch64-apple-darwin]
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          target: ${{ matrix.target }}
      - run: cargo build --release --target ${{ matrix.target }}
```

---

## 使用 cross 工具（可选）

如果有 Docker 环境，可以使用 `cross` 工具：

```bash
# 安装 cross
cargo install cross --git https://github.com/cross-rs/cross

# 交叉编译（需要 Docker）
cross build --release --target x86_64-pc-windows-gnu
```

**注意**: `cross` 需要 Docker 或 Podman 容器引擎。

---

## 二进制位置

| 目标平台 | 输出路径 |
|----------|----------|
| Linux x64 | `target/release/sacode` 或 `target/x86_64-unknown-linux-gnu/release/sacode` |
| Windows x64 | `target/x86_64-pc-windows-gnu/release/sacode.exe` |
| macOS x64 | `target/x86_64-apple-darwin/release/sacode` |
| macOS arm64 | `target/aarch64-apple-darwin/release/sacode` |

---

## 放入 npm 包

```bash
# Linux
cp target/release/sacode npm-package/platforms/sacode-linux-x64
chmod +x npm-package/platforms/sacode-linux-x64

# Windows
cp target/x86_64-pc-windows-gnu/release/sacode.exe npm-package/platforms/sacode-win32-x64.exe

# macOS x64 (Intel)
cp target/x86_64-apple-darwin/release/sacode npm-package/platforms/sacode-darwin-x64
chmod +x npm-package/platforms/sacode-darwin-x64

# macOS arm64 (Apple Silicon)
cp target/aarch64-apple-darwin/release/sacode npm-package/platforms/sacode-darwin-arm64
chmod +x npm-package/platforms/sacode-darwin-arm64
```

---

## GNU vs MSVC

### GNU 目标 (`x86_64-pc-windows-gnu`)

- 优点: Linux 上可交叉编译，无需 Windows SDK
- 缺点: 依赖 mingw 运行时，可能有兼容性问题
- 适用: CI 环境快速构建

### MSVC 目标 (`x86_64-pc-windows-msvc`)

- 优点: 原生 Windows 工具链，兼容性最好
- 缺点: 需要在 Windows 上构建或使用复杂交叉编译设置
- 适用: 官方 Windows CI (`windows-latest`)

---

## 当前方案

SaCode 采用混合策略：

- **本地/Linux 开发链路**: 使用 `x86_64-pc-windows-gnu` 交叉编译
- **官方 GitHub Actions 发布链路**: 使用 `windows-latest` 构建 `x86_64-pc-windows-msvc`

两者生成的二进制都可正常运行。

发布时请以 `docs/release/RELEASE.md` 和 `scripts/check-release.js` 的校验要求为准。

---

## 注意事项

### 1. 依赖限制

某些 Rust crate 可能不支持 GNU 目标或需要额外配置。遇到链接错误时，检查 crate 文档。

### 2. 文件大小

交叉编译的 Windows 二进制通常比 MSVC 版本大，因为包含更多运行时代码。

### 3. 动态链接

GNU 目标可能依赖 `libgcc_s_seh-1.dll` 等动态库。静态链接可通过 linker flag 配置：

```toml
[target.x86_64-pc-windows-gnu]
linker = "x86_64-w64-mingw32-gcc"
ar = "x86_64-w64-mingw32-gcc-ar"
rustflags = ["-C", "linker=static"]
```

---

## 验证编译结果

```bash
# 检查文件是否存在
ls target/x86_64-pc-windows-gnu/release/sacode.exe

# 检查文件类型
file target/x86_64-pc-windows-gnu/release/sacode.exe
# 输出: PE32+ executable (console) x86-64, for MS Windows
```

---

## 相关配置文件

- `.cargo/config.toml` - linker 和 target 配置
- `Cargo.toml` - 工作区和包配置
- `rust-toolchain.toml` - Rust 版本固定
