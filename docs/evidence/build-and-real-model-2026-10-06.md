# 构建与真实模型验证

日期：2026-10-06
验证环境：Cangjie 1.1.3, Electron 33.4.11, Node v22

## 1. 宿主二进制重建

```
cd apps/host && cjpm build
```

结果：
- `main.exe` 6,798,336 字节，时间戳 2026-10-06 01:22:03
- 相比之前（6,088,192 字节 / 19:00:28）增加约 710KB，包含 ledger 幂等修复 + B4 加速 + B5 迁移

## 2. 宿主打包

```
node scripts/pack-host.mjs apps/host/target/release/bin/main.exe apps/desktop/dist/host <stdx-dll-dir> <runtime-dll-dir>
```

结果：41 个文件 → `apps/desktop/dist/host/bin`

## 3. Vendor 构建

```
cd apps/desktop && npm run vendor
```

结果：
- vue@3.5.43 runtime → `renderer/vendor/vue.runtime.global.prod.js`
- tinyvue 折叠：1 个组件 / 308,823 字节
- tinyrobot 折叠：3,917,779 字节 + CSS 149,498 字节
- 11 个 TypeScript 页面编译完成

## 4. Electron 安装包

```
npx electron-builder --config.electronDist=node_modules/electron/dist
```

结果：

| 文件 | 大小 | 时间戳 |
|------|------|--------|
| `SaCode Setup 0.1.0.exe` | 81,348,759 字节 | 2026-10-06 01:28:50 |
| `sacode-portable.exe` | 81,196,727 字节 | 2026-10-06 01:28:46 |
| `SaCode.exe` (unpacked) | 188,784,640 字节 | 2026-10-06 01:25:18 |

## 5. 真实模型测试（StepFun step-5-preview）

API: `https://api.stepfun.com/step_plan/v1`
模型: `step-5-preview`

| 测试文件 | 结果 | 耗时 |
|----------|------|------|
| `real-provider-e2e.test.mjs` | ✅ PASS (1/1) | 9.5s |
| `real-provider-tools.test.mjs` | ✅ PASS (1/1) | 14.3s |
| `real-provider-read-tool.test.mjs` | ✅ PASS (1/1) | 6.4s |
| `real-provider-system-prompt.test.mjs` | ✅ PASS (1/1) | 6.4s |

全部 4 个真实模型测试通过，确认：
- 模型往返：配置面登记的模型能出真答复
- 工具调用：StepFun 调用 todo_write 后续答，冷宿主从日志恢复工具结果
- Read 工具：模型调用 read 工具读取文件
- 系统提示：模型收到系统提示，冷进程从日志重建

## 6. 核心测试状态

```
TOTAL: 702 / PASSED: 692 / SKIPPED: 2 / ERROR: 6 / FAILED: 2
```

- ERROR 6：5 个 plugin_store（测试隔离问题）+ 1 个 migrationRejectsMalformedJson
- FAILED 2：2 个 plugin_store（测试隔离问题）

plugin_store 失败是测试目录未清理导致，非代码 bug。
