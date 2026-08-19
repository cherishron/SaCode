# 开源策略评估

> 最后更新：2026-08-19
> 状态：✅ 评估完成，仅评估不修改 LICENSE（需法律审查）

---

## 一、背景

SaCode 当前采用 MulanPSL-2.0 许可证。随着产品 v1.0 临近及国内开发者社区的接入需求，需要评估许可证切换对生态、贡献者、分发渠道的影响。

---

## 二、候选许可证对比

### MulanPSL-2.0（当前）

| 维度 | 评估 |
|------|------|
| 特点 | 中国本土开源协议，要求"对等方式回应"，禁止对等贡献者以外的商业使用 |
| 优势 | 本土合规意识强；防止海外大厂直接商用 |
| 劣势 | npm/GitHub 生态兼容差；IDE 市场审核不认可；贡献者需额外审查 |
| 适用场景 | 纯国内、非商业化分发 |

### Apache-2.0（推荐迁移目标）

| 维度 | 评估 |
|------|------|
| 特点 | 宽松许可，允许商用/闭源，要求保留声明 + 专利授权 |
| 优势 | GitHub/npm/VSCode Marketplace 全平台兼容；Apache CLA 友好；与 Rust 生态一致（多数 Rust 项目采用） |
| 劣势 | 商业闭源复用不受限 |
| 风险 | 需确保所有既有贡献者授权同意切换 |

### MIT

| 维度 | 评估 |
|------|------|
| 特点 | 最宽松，最小限制 |
| 优势 | 最大兼容 |
| 劣势 | 无专利授权条款，对大型项目保护不足 |
| 结论 | Rust 工具链推荐 Apache-2.0 或 MIT 双许可，Apache-2.0 更适合多模块项目 |

### AGPL-3.0

| 维度 | 评估 |
|------|------|
| 特点 | 强 Copyleft，网络使用视为分发 |
| 劣势 | 企业不敢用；VSCode 扩展市场明确禁止；CLI 场景不友好 |
| 结论 | 排除 |

---

## 三、切换影响分析

### 3.1 贡献者授权

MulanPSL-2.0 对贡献者有特定限制。切换为 Apache-2.0 需要：

1. **排查既有贡献者授权状态**：统计 `git log --format='%aN' | sort -u` 的所有贡献者，确认是否有 CLA 或授权声明
2. **补签 DCO/CLA**：对未签署的贡献者补签 Developer Certificate of Origin
3. **过渡期方案**：切换后新贡献者走 Apache CLA，历史代码按 MulanPSL-2.0 保留（文件级许可）

### 3.2 代码库文件级许可

Rust 项目惯例：每文件头部保留版权声明，允许部分文件保留不同许可证（如 `kernel/src/schema/` 下部分引用外部代码的模块）。

### 3.3 贡献者名单排查

| 贡献者类型 | 处理方式 | 优先级 |
|------------|----------|--------|
| 提交过代码 | 统计 `git log --format='%aN,%aE' | sort -u` | P0 |
| 提交过 Issue | 无需补签 | P2 |
| PR 合并者 | 检查是否有 Contributor 声明 | P1 |
| 早期 fork 贡献者 | 文件级保留原许可 | P1 |

### 3.4 npm 分发策略评估

#### 方案 A：预编译分发（推荐）

```
发布流程：
CI (GitHub Actions) → 交叉编译 (x86_64/macos/aarch64) → 打包 → npm publish
```

| 维度 | 评估 |
|------|------|
| 用户体验 | 最佳，`npm install sacode` 即用 |
| CI 成本 | 中（需 3 个平台的 cross-compile） |
| 维护成本 | 中（需维护预编译脚本） |
| 推荐平台 | `x86_64-unknown-linux-gnu`, `x86_64-apple-darwin`, `x86_64-pc-windows-msvc` |

#### 方案 B：源码构建

```
用户流程：
npm install sacode → 自动 cargo build → 编译二进制 → 本地执行
```

| 维度 | 评估 |
|------|------|
| 用户体验 | 差，用户需安装 Rust 工具链（~1GB 下载） |
| CI 成本 | 低（只需发布源码） |
| 维护成本 | 低 |
| 推荐平台 | 不推荐作为主要分发方式 |

#### 方案 C：双分发（最佳，v1.1+ 引入）

预编译分发 + 源码 fallback（`postinstall` 脚本自动检测平台，有预编译则使用，无则触发源码构建）。

| 维度 | 评估 |
|------|------|
| 用户体验 | 最佳 |
| CI 成本 | 高（需维护预编译矩阵 + 源码构建） |
| 维护成本 | 高 |
| 推荐时机 | v1.1 引入 |

#### 结论

v1.0.0 采用 **方案 A（预编译分发）**，v1.1 升级到 **方案 C（双分发）**。

### 3.5 npm 包结构规划

```
sacode/
├── package.json          # npm 包元数据
├── bin/
│   └── sacode            # 安装入口脚本（检测平台+下载/解压预编译）
├── dist/
│   ├── sacode-linux-x64/
│   │   └── sacode
│   ├── sacode-darwin-x64/
│   │   └── sacode
│   ├── sacode-darwin-arm64/
│   │   └── sacode
│   └── sacode-win-x64/
│       └── sacode.exe
├── README.md
└── postinstall.js        # 自动检测平台并解压
```

### 3.6 国内分发渠道

| 渠道 | 兼容性 | 备注 |
|------|--------|------|
| npm（海外） | Apache-2.0 ✅ | 标准 |
| npmmirror（淘宝） | Apache-2.0 ✅ | 同步镜像 |
| 自建 registry | Apache-2.0 ✅ | 内网 |
| GitHub Releases | Apache-2.0 ✅ | 标准 |
| VSCode Marketplace | Apache-2.0 ✅ | 需要合规声明 |
| Rust Crates.io | Apache-2.0 ✅ | 标准 |

---

## 四、npm 源码构建路径评估

### 4.1 构建前提

| 依赖 | 版本要求 | 安装方式 |
|------|----------|----------|
| Rust | ≥1.82 | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| Node.js | ≥20 | 或直接从 npm 执行 `npx cargo build` |
| CMake | 推荐 | Windows 需额外安装 |
| OpenSSL | 可选 | Linux 需 `libssl-dev` |

### 4.2 源码构建流程

```bash
# 1. npm install（触发 postinstall）
npm install sacode

# 2. 若系统无预编译，触发源码构建
#    → postinstall.js 检测到无预编译
#    → 执行 `cargo build --release`
#    → 输出到 node_modules/sacode/dist/

# 3. 执行
npx sacode --help
```

### 4.3 源码构建的风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Rust 工具链缺失 | 构建失败 | postinstall 中检测并提示安装 |
| Windows CMake 缺失 | 构建失败 | 提供一键安装脚本 |
| OpenSSL 版本不匹配 | 编译错误 | 使用 vendored OpenSSL 特性 |
| 构建时间过长（10-20 分钟） | 用户流失 | 提供预编译入口 |

### 4.4 推荐：预编译构建脚本

```bash
#!/bin/bash
# build-release.sh - CI 预编译发布脚本

set -euo pipefail

VERSION=$(cargo pkgid | cut -d'#' -f2)
OUT_DIR="release/${VERSION}"
mkdir -p "$OUT_DIR"

# 目标平台矩阵
TARGETS=(
  "x86_64-unknown-linux-gnu"
  "x86_64-apple-darwin"
  "aarch64-apple-darwin"
  "x86_64-pc-windows-msvc"
)

for TARGET in "${TARGETS[@]}"; do
  echo "=== Building for $TARGET ==="
  rustup target add "$TARGET"
  cargo build --release --target "$TARGET"

  # 打包
  NAME="sacode-$(echo "$TARGET" | sed 's/-/ /g' | awk '{print $1 $2}')"
  case "$TARGET" in
    *windows*)
      cp "target/$TARGET/release/sacode.exe" "$OUT_DIR/$NAME.exe"
      ;;
    *)
      cp "target/$TARGET/release/sacode" "$OUT_DIR/$NAME"
      chmod +x "$OUT_DIR/$NAME"
      ;;
  esac

  tar czf "$OUT_DIR/$NAME.tar.gz" -C "$OUT_DIR" "$NAME"${NAME:+.exe}
  echo "  → $OUT_DIR/$NAME.tar.gz"
done

echo "=== Build complete: $OUT_DIR ==="
ls -la "$OUT_DIR"
```

### 4.5 构建成本估算

| 平台 | 预计耗时 | CI 时间 | 备注 |
|------|----------|---------|------|
| Linux x86_64 | 5-8 min | 10 min | GitHub Ubuntu runner |
| macOS x86_64 | 8-12 min | 15 min | GitHub macOS runner |
| macOS ARM64 | 8-12 min | 15 min | GitHub macOS runner |
| Windows x86_64 | 10-15 min | 20 min | 需缓存依赖 |
| **总计** | **~30 min** | **60 min** | 使用 CI 缓存后 ~20 min |

---

## 五、推荐决策路径

```
T0（当前）     保持 MulanPSL-2.0 ✅ 已执行
   ↓
T1（法律审查）  律师评估 MulanPSL → Apache-2.0 切换可行性 ⬜ 待启动
   ↓
T2（授权补签）  联系既有贡献者补签 Apache CLA ⬜ 待启动
   ↓
T3（迁移）     代码仓库根目录更新 LICENSE，各文件头保留版权声明 ⬜
   ↓
T4（双许可期）  新代码 Apache-2.0，历史代码文件级许可并存 6 个月 ⬜
   ↓
T5（统一）     全部代码统一 Apache-2.0 ⬜
```

---

## 六、过渡期风险

| 风险 | 缓解 |
|------|------|
| 部分贡献者失联无法补签 | 文件级保留原许可，不阻塞迁移 |
| 社区对新协议不适应 | 提前公告 30 天，提供 FAQ |
| npm 预编译失败 | CI 降级为源码发布，保留 cargo install 入口 |
| 构建矩阵覆盖不足 | 从 v1.0.0 开始，逐步增加 arm64 和 aarch64 |

---

## 七、下一步

| # | 任务 | 优先级 | 状态 |
|---|------|--------|------|
| 1 | 法律团队完成 MulanPSL-2.0 → Apache-2.0 切换合规评估 | P0 | ⬜ 待启动 |
| 2 | 贡献者名单统计与 CLA 补签 | P0 | ⬜ 待启动 |
| 3 | CI 预编译脚本开发（`build-release.sh`） | P1 | ⬜ 待开发 |
| 4 | npm 发布配置（`package.json` 准备） | P1 | ⬜ 待开发 |
| 5 | VSCode Marketplace 合规检查清单 | P2 | ⬜ 待开发 |
| 6 | 社区公告（许可证切换 + npm 发布） | P2 | ⬜ 待公告 |

---

## 附录：许可证切换前后对比

| 项目 | MulanPSL-2.0 | Apache-2.0 |
|------|:---:|:---:|
| 商用闭源复用 | ❌ | ✅ |
| 专利授权 | ❌ | ✅ |
| GitHub 生态兼容 | ⚠️ | ✅ |
| npm 兼容 | ⚠️ | ✅ |
| VSCode Marketplace | ❌ | ✅ |
| 中国本土合规 | ✅ | ✅ |
| 贡献者门槛 | 高 | 低 |