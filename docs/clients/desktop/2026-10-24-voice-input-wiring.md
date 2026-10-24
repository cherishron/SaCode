# 2026-10-24 语音输入接线（F18 最小闭环：录制→登记→转写→回填草稿）

## 起因与范围

用户反馈「语音功能还无法点击」。核查：`apps/desktop/renderer/app.js` 的 `composer-voice` 原为**刻意的禁用占位**（`disabled:true` + "当前版本尚未支持语音输入"），且后端未接通——Host 的 `voice/*` 未接入 `main.cj` 分派（`voice_rpc.cj` 仅是未装配切片），桌面无麦克风采集、无 voice IPC、无 ASR 配置。用户选定"最小真实闭环"：**点击录音→停止→转写→回填草稿（可撤销、不自动发送）**，ASR 未配置时按钮可点但明确报"未配置提供方"，本轮先做接线与录制，真实转写按配置验收。

本批为**独立增量**，不混入当前桌面交付候选；工作区另有并发会话改动（含 `apps/host/src/model_pull_job.cj` 等），未触碰、未回退。

## 改动

### 1. core（未改）

复用既有 `core/src/voice.cj`、`voice_exec.cj`（`VoiceExecutor` 固定 `--wav <path> --lang <lang>`）与 `prompt_enhance.cj`/`enhance_charge.cj`。本批不改 core。

### 2. Host（`apps/host/src/voice_rpc.cj`、`main.cj`）

- `VoiceRpc` 增 `sessionRoot` 与 `voice/record` 的 `action:"import"`：桌面采集适配层把已封存 WAV 写到本会话隔离目录 `voice/v1/<recordingId>.wav`，宿主**只按固定命名**读取（不接受路径、URL、shell 参数），校验 id 字符集、摘要、字节数（44..25 MiB）后 `registerRecording` 登记；同 id 重复登记且摘要/字节不一致即拒绝。
- `voice/transcribe` 增**服务端发号**：客户端拿不到录音摘要与 ASR 二进制、无法自行固定票据，故缺 `approvalId` 时由宿主按规范参数 `askForCall` 发号并返回 `{state:"pending-approval",approvalId}`；作答后带票重试，走既有 `consumeExactForCall`。`prepareApproval` 原语义保留。
- `voice/describe` 的 `record.supported` 改按 `sessionRoot` 判定，不再恒 `false`+`voice-record-not-available`。
- `main.cj` 接线：`voiceRpc` 按会话装配/关闭/退出 cancel/主循环 `settle()`；`handleAdapterRpc` 增加 `voice/record|voice/transcribe|voice/describe` 三条**字面量**分派（与能力声明双向一致）；`allowedDuringTurn` 增 `voiceSide` 独立车道；`initialize` capabilities **+3**；ASR 二进制取自 `getVariable("SACODE_ASR_BINARY")`，缺省则转写 fail-closed（`voice-asr-not-configured`）。

**范围决定**：`voice/record`（导入登记）不设独立审批票——OS 麦克风权限 + 用户显式点击即意图，且只写本会话隔离目录、不触网不发模型请求；转写（外部 ASR 子进程）仍走工单。

### 3. 桌面 IPC（`preload.cjs`、`main.cjs`）

新增 4 条通道（闭集逐字段校验，渲染层给不出落盘路径/URL/外部参数）：
`sacode:voiceDescribe`、`sacode:voiceRecord`（主进程校验 RIFF/WAVE 头 + 长度上限后写 `voice/v1/<recordingId>.wav`、算 sha256、调 `voice/record`）、`sacode:voiceTranscribe`、`sacode:voiceTranscribeCancel`。

### 4. 渲染层（`renderer/voice.js` 新增，`app.js`、`tool-approval-state.js`、`index.html`、`product-design.css`）

- `voice.js`：`MediaRecorder` 录音 → 解码 → 重采样 16kHz 单声道 → 16-bit PCM WAV → `voiceRecord` 登记 → 宿主发号 → 用户在**工具审批卡**允许一次 → `voiceTranscribe` 启动 → `voiceDescribe` 轮询 → 成功文本仅经 `SaCodeComposerEdit.replace` 写入草稿（可 Ctrl+Z 撤销），**永不自动发送**；`prefers-reduced-motion` 下录音脉冲动效关闭。
- `composer-voice` 由 `disabled:true` 改为可点击并带 `data-state`（idle/requesting/recording/processing/approval/running/error），录音中换停止图标。
- `tool-approval-state.js` 增 `source==='voice-transcribe'` 分支：只负责应答，再把票据交回语音装配；不伪造授权、不自动放行。

## 读数

- `apps/desktop/test/voice.test.mjs`（新增）：**5/5，0 失败/跳过**——WAV 头尺寸、失败分类中文、无采集能力不假装录音、录音→登记→待审批→允许→**只写草稿且不自动发送**、拒绝不启动不写草稿。
- 渲染层相关回归 `renderer-syntax` + `renderer-bundle-guard` + `page-sources-parse` + `voice` + `tool-card` + `msg-waiting`：**20/20，0 失败**。
- `node scripts/check_ipc_surface_parity.cjs`：**GATE PASS**，preload **202** ↔ main **202**，双向差集为空（基线为 198，本批 +4）。
- `node scripts/check_host_method_surface.cjs`：`分派未声明 0 条`；新增 3 条语音方法与能力声明双向一致。该门禁另有 2 条 FAIL（`frozen-denominator` 分母常量 171 陈旧 + 31 条适配器方法账），**与 HEAD 逐字相同**，属既有，非本批引入。
- Host 编译：该轮 `cd apps/host && cjpm build` 在 `model_pull_job.cj:120/126` 报 2 个语义错误（引用 core 新 API 而 core 产物陈旧；**该文件为并发会话改动，非本批触及**）。同一次编译中 `voice_rpc.cj`、`main.cj` **零错误**（35 warnings 为既有）。

## 证据等级与未验边界

- 以上为**源码 + 单测 + 静态门禁**证据，**不是 GUI 验收、不是打包态、不是真实任务**。
- **未验**：真实麦克风采集与真实 ASR 可执行文件（`SACODE_ASR_BINARY` 未配置，转写路径 fail-closed 未实跑）；真实转写文本；GUI 实机观感；打包/安装；`voice/enhance` 未接入（Host `handles` 含之但未声明/未接线，UI 不提供）。
- 未提交、未推送、未安装、未发布；不改变当前桌面候选身份与主阻塞；不升级 F18 为完成。