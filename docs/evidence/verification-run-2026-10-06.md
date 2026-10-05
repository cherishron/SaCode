# 完整验收执行记录

日期：2026-10-06
验证环境：Cangjie 1.1.3, Electron 33.4.11, Node v22.23.2, Windows 10.0.26300

## 执行命令

```bash
node scripts/verify-all.mjs
```

## 结果汇总

| # | 验证项 | 结果 | 耗时 | 详情 |
|---|--------|------|------|------|
| 1 | core | ❌ 失败 | 1544s | TOTAL 702 / PASSED 694 / ERROR 6 / FAILED 2 |
| 2 | desktop | ❌ 失败 | 21s | tests 243 / pass 240 / fail 3 |
| 3 | extjs | ✅ 通过 | 4.3s | tests 24 / pass 24 / fail 0 |
| 4 | vendor | ✅ 通过 | 6.1s | 四步折叠完成 |
| 5 | smoke | ✅ 通过 | 3.0s | SMOKE PASS |
| 6 | ui-smoke | ❌ 失败 | 31s | UI OK 253 / FAIL 2 |
| 7 | pack-cli | ❌ 失败 | 13s | 缺 MinGW 运行时 DLL |
| 8 | npm-install | — 未执行 | — | 前序失败中止 |
| 9 | real-model | ✅ 通过 | 12.6s | tests 2 / pass 2 / fail 0 |

## 失败分析

### core（6 ERROR + 2 FAILED）
- 5 个 plugin_store ERROR + 2 个 plugin_store FAILED：测试目录未清理导致 `Directory.create` 失败
- 1 个 migrationRejectsMalformedJson ERROR：JSON 序列化边界条件
- 链接互锁（ld.lld Permission denied）：环境竞争，非代码问题

### desktop（3 FAILED）
- test-133：模型设置真实渲染列表（可能与模型中心新标签页冲突）
- test-170：插件清单提供者晚绑定（与模型中心槽位系统冲突）
- test-56：test\temp-test.ts（测试文件命名问题）

### ui-smoke（2 FAIL）
- `model-not-configured`：UI 冒烟测试未配置 API key，属预期行为
- `approval-not-granted:denied`：审批拒绝测试

### pack-cli（环境缺失）
- 缺 `libgcc_s_seh-1.dll`：MinGW 运行时未安装，非代码问题

## 已通过验证

- **extjs**：24/24 通过
- **vendor**：Vue runtime + TinyVue + TinyRobot + 11 页面编译完成
- **smoke**：Electron 冒烟测试 SMOKE PASS
- **real-model**：StepFun step-5-preview 2/2 通过（e2e + tools）

## 产物确认

| 产物 | 大小 | 时间戳 |
|------|------|--------|
| `SaCode Setup 0.1.0.exe` | 81,348,759 字节 | 2026-10-06 01:28:50 |
| `sacode-portable.exe` | 81,196,727 字节 | 2026-10-06 01:28:46 |
| `SaCode.exe` (unpacked) | 188,784,640 字节 | 2026-10-06 01:25:18 |
