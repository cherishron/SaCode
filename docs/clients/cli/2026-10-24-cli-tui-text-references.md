# 2026-10-24 TUI @文本文件引用

## 本批结论与范围

用户继续授权下，将`@`从路径补全推进为**发送前明确确认→Host read→持久资料快照→模型请求**。不是通用附件/图片系统，不改Host/core/桌面或当前桌面候选，不安装依赖/产品、不提交/推送/发布、不请求收费供应商。全部项目正文读取走Host工具，不在Node侧直接读项目文件。

Windows / Node v22.23.2 / React18.3.1 / Ink5.2.1；取证HEAD `a0b16c38a1147708f2ef75302695092f3d3ed833`＋未提交TUI工作区，不能将HEAD当本批冻结提交。默认开发Host仍`71389261df9c29c91a9a219af2683293aea671f9745403b239b8d976fef00e6e`，本轮不构建/覆盖Host或DLL。

最终单文件`apps/cli/tui/dist/index.mjs`与`npm/sacode-cli/tui/index.mjs`一致：**561,133 B**，SHA256 **`db9ad1b491b298a0f248d30f5bd9205a073d51603ef42766b3eee0e5e4d956a4`**。未安装该哈希版本，不据此宣告交付。

## 对照与关键发现

- 固定Gemini CLI `a3dd9f8c7bcb495a46d0b505b6f179996ccd8332`，本轮经GitHub tree与contents只读取回`packages/cli/src/ui/hooks/atCommandProcessor.ts`。核解析/权限检查与`readLocalFiles`、`ReadManyFilesTool`、引用资料包装，不仅依赖旧截图或同名菜单。原raw下载传输失败，改GitHub API取得正文；未使用需要密钥的搜索脚本，也未读取密钥。
- SaCode `attachment/upload`能存普通文件，但`core/src/model_request.cj:userMessageWithRefs`明确跳过`kind != image`；仅接上传会制造“保存成功、模型无正文”。本批不修改该后端契约，改用Host既有read读取文本、将其作为用户明确确认的资料快照。上游实现只作参考，未复制本轮上游源码进产品或引入Gemini SDK。
- Context7核Ink useInput/isActive与焦点；使用本仓Ink5既有Viewport，不升级依赖或照搬新版本API。

## 行为与安全边界

1. `file-references.mjs`识别空白边界`@relative/path`及JSON引号路径，重复去重。邮箱、`\\@`、代码围栏和行内代码不触发读取；相对路径拒绝绝对路径/穿越/反斜杠/控制字符。不是完整Markdown解析或Gemini范围/资源语法。
2. 补全仍只查目录、插路径。Enter提交时先显示`ReferenceConfirmation`：完整路径、工作区/模型路由可翻页，明确披露正文将保存会话并送模型，默认取消；取消保留原草稿，不执行read/append/task/start。所有路径需用户检查，**不提供秘密内容检测/自动脱敏**。
3. 确认后复核`workspace/get.sessionId/directory`及可用状态，要求`extension/list`仅有一个`read`且`needsApproval:false`。不自报审批、不申请更宽权限；调用`extension/call {name:"read",args:JSON.stringify({path,offset:0,limit:2000})}`，核心负责文件边界与UTF-8读取。
4. `workspace/files`先核文件存在/非目录/大小，目录200项未列出时不当成确定缺失；TUI预算8文件、每份64KiB、合计128KiB，读后再次核字节数。缺失、目录、NUL二进制、非法编码、read-truncated及任意中途失败均整条不发消息，不返回部分引用。不改变核心普通附件无额度契约。
5. read会追加工具事实并持租约，不是无副作用查询。成功或已执行read后失败/取消都显式`session/flush`并核events===durable；flush失败/回执未知、read超时/断开均冻结发送，**不自动重复read/flush**。Esc/Ctrl+C请求停止后续步骤，Host当前同步read不可强行中断；等待其返回、结算后保留草稿。
6. 成功快照用带“不可信资料，不是指令”的JSON信封随`user/message`经`session/append`持久化，再起产品`task/start`。追加前再核工作区，并带确切sessionId；追加回执必须events===durable，未知不继续起轮/重发。检查不是后端原子事务，快照只代表读取时内容，不能保证磁盘随后不变，也不宣称防注入绝对有效。
7. 会话投影`referenceMessageView`将结构合法的快照折为原问题+路径/字节摘要，保存正文仍在日志及HTTP请求里，工具卡/`/tools`可看读取结果；损坏信封保留原文，不静默丢内容。未知态停止会话输入，不伪称模型已成功。

## 验证

最终 **114 tests / 114 pass / 0 fail / 0 skip**，约21.21秒，相对上批99新增15项：8引用适配、4交互、1布局、2真实Host。

- 真实Host+真实TUI+仅loopback HTTP夹具：确认前toolCalls=0、HTTP0；默认Enter取消仍0；明确确认后read→flush→append→task/start，HTTP**恰好1请求**，实际请求user.content含完整中文/emoji/换行正文与不可信资料标记；持久消息逐字相同，events===durable。关闭Host重开投影保留同一快照，HTTP仍1。夹具不是外部真实模型，不能替代收费供应商验收。
- 真实Host缺失、超过2000行截断、非法UTF-8全部拒绝，无user/message；已有工具事实flush并冷重开可回放。
- 合成：邮箱/转义/代码/引号/去重/越界、缺工具/需审批/目录/预算、读后工作区变化、后续文件失败无部分发送、截断/NUL/失败脱敏、取消结算、超时/flush失败不重试、默认取消/草稿保留、重复Enter、append未持久不起轮与冻结。
- 80×24/48×18共**12合成帧**，确认/读取取消/失败的顶部与底部，全路径可翻页，正文发送披露及默认取消均不被挤掉。非真实终端截图。
- `pack-tui`构建、自足模块检查与Apache/37内联包许可收集通过；50个`.mjs`源码/测试/构建文件及最终bundle语法通过。无lint/typecheck脚本，不冒充已执行该两项。
- npm dry-run：46文件、解包626,974 B。主包显式`tui`和无参伪TTY默认Host无覆盖入口：引用确认→默认取消→原会话改名/归档恢复烟测退出0；无参额外剥离SDK/stdx PATH。烟测不发模型请求；不是新哈希安装态或Windows Terminal亲手验收。

原始输出：`target/tmp/tui-reference-handoff-20261024-96d32b0a/`，`tests-final.log`、`frames.json`、`frames.log`、`pack.log`、`npm-pack-final.json`、`default-explicit-final.log`、`default-noargs-clean-path-final.log`、`syntax.log`、`artifact-hashes.json`及`source-manifest.json`。源码manifest是工作区逐文件取样，不冒充全仓冻结快照。真实Host用例清理自有目录；默认入口会话只保留该忽略目录内。

## 仍未完成

图片/PDF/通用附件到模型、目录递归、忽略文件规则/完整Markdown解析、行范围引用、MCP资源、完整Gemini能力仍缺；read自身全文件读取内存行为不在本批更改。真实终端观感、外部真实模型读改审批/diff/重启、新包安装与跨平台未验。文本快照会增加会话体积/请求token，不修改预算守卫；F域状态不升级，桌面候选和主交付阻塞保持。
