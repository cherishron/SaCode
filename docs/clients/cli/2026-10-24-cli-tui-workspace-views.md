# 2026-10-24 TUI Home/End、路径引用与只读工作区差异

## 授权与范围

用户要求“继续补齐”。本批限定为已有Host面消费和终端按键适配，不改 `.cj`、桌面、权限/审批/取消/结算契约，不读取工作区文件正文、不上传字节、不执行Git写操作。当前桌面候选与主阻塞不变。没有收费请求、新依赖安装、Git提交/推送或发布。

## 当前实际能力

### 输入按键

`terminal-input.mjs` 适配固定Ink5缺失的Home/End字段。通过 `useStdin` 的内部已分发input事件保留原始chunk，再由既有 `useInput` 解码；不从stdin另行read、不消费其他监听器。支持CSI H/F、O H/F、1~/4~/7~/8~；DEL(127)修为Backspace，Delete序列不改。草稿和配置表单同一适配，审批/对话框仍先拿焦点。**内部事件是版本耦合点**：Ink升级须重验，缺少prependListener明确报错；拆包转义、所有扩展终端协议未支持。不扫描粘贴内部序列。

### `@`路径菜单

- 仅调用 `workspace/files`（path相对目录），100ms防抖、光标处识别、目录前缀过滤、最多200项提示；目录/文件分组显示，支持嵌套目录与空格路径。
- Tab/Enter选文件只插入 `@"相对路径"`，不发送；选目录继续浏览。邮箱不触发，路径越界/控制字符拒绝，工作区directory错配和宿主error不当空目录；Esc后迟到响应不重开。
- **不是完整Gemini文件附件语义**。Host现有attachment/upload只收客户端提供的base64，没有“给工作区路径生成引用票据”的接口；本批不绕开核心自己读磁盘。本版只是路径文字，模型之后需要通过核心read工具读取，未保证实际读取。没有附件票据/正文注入，也不偷偷把文件内容拼入提示词。
- 含双引号目录的递归、跨目录模糊/递归搜索、附件/图片、符号链接的完整文件引用身份校验仍缺；列表安全边界沿用Host既有实现，本批不宣称新增安全文件系统能力。

### `/diff`

- 使用已存在 `workspace/git-status` 的NUL状态与 `workspace/git-diff`，参数按源核对精确字段数；每次校验sessionId、directory及patch的path/scope。TUI不提供任意argv/shell。
- 列表区分暂存(index)、未暂存(working)、未跟踪；rename来源不当另一个文件；截断尾记录不作完整状态。
- patch原文来自Host，按diff行展示；truncated明确警告。缺Git/非仓库/不在仓库根/退出码失败/身份错配都报错，不显示干净。
- 未跟踪文件没有索引基线，不发diff请求或自造新增patch；空patch明确说明二进制/rename/状态变化等可能性，不能当“无变更”。查询展示整个工作区，不归因AI，更不stage/commit/push。
- 对应源：`main.cj` handleRpc41/43，`core/src/git_workbench.cj`；仅阅读核契约，未修改/编译仓颉。

## 实跑验证

- Windows、Node v22.23.2，工作区未提交。开发态Host `apps/desktop/dist/host/bin/sacode-host.exe` SHA256延续 `052917f95f2d6f966aa94a941b988d07f1081d50c1c0b8d44dc008297f4fb4ea`（非当前桌面候选同源验收）。
- `npm test`：**63 tests / 63 pass / 0 fail / 0 skip**，约10.43秒，相对上批52新增11条。包括Home/End/DEL与粘贴区分、中文空格路径/目录、晚到关闭、只查列表不读正文、Git身份与截断、UI实际diff/错误/未跟踪分支。
- 真实Host新增1条：私有临时项目浏览中文文件和目录→非Git目录明确失败→指向本仓读取当前Git状态及 `npm/sacode-cli/package.json` patch，与同目录只读Git命令输出逐字一致（只断言布尔，不回显工作区正文）→查询前后会话事件数不变。**没有**在用户仓库git init/add/commit、写文件或改索引；测试合成文件只在target/tmp自有目录。
- 真实Host其余2条沿用引导/投影追加、会话目录冷重开，不等于真实模型任务或配置保存验收。
- `node scripts/pack-tui.mjs` rc=0，自足校验和既有随包许可收集通过。dist与主包单文件均 **523,224 B**，SHA256 `74a9c6e78acfb9f9737486710f3cb3a445371d8ee6325aa1b4bb2296a2c7d7e5`。
- 33个TUI源码/测试/构建`.mjs`的 `node --check` 通过；无lint/typecheck脚本，不冒充两项。新包伪TTY `/help`→Ctrl+D rc=0，npm pack dry-run rc=0；沿用10帧旧场景回归，但未宣称这些帧覆盖本批全部文件/diff状态。
- 原始读数：`target/tmp/tui-workspace-final-20261024-fba53f81/{tests.log,frames.json,smoke.log,npm-pack.json}`。

## 未验/下步

真实终端Home/End/跨chunk控制码、完整附件引用和模型实际读取、真实模型修改后在TUI验diff及冷重开、新包安装/平台组合仍待验；MCP/技能/计划、完整编辑键等仍保留。当前称“功能接线/局部证据、候选待验”，不升级F域完成状态。
