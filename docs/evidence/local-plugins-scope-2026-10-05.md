# 用户自写插件：范围及现有接入证据（2026-10-05）

用户确定：SaCode 支持自己写插件给自己使用；市场、发布账号与产品登录都不能成为本地使用的前提。用户可手写，也可由 SaCode 协助生成代码。完整产品需求见 [PRD §2.4](../product/PRD.md)。本批更新需求和验收范围，未修改实现代码。

## 上游归类

冻结提交：`639ed015397290b3745d163aafe02ffee4aa3f84`。

- [Plugin Manager](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/boot/plugin-manager/README.md) 已有绝对本地目录检查、包安装、profile bundle 装配、组件启停、取消及失败恢复；安装和激活是不同结果，脚本授权也独立。按用户的能力来源规则，这些属于复刻接入。
- [Extensions 分组](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/extensions/README.md) 区分运行时 Host/Client 扩展与 Creator 的持久插件安装；不能把一次会话内加载回调等同持久插件装配。
- 完整 DSH 插件须承接 Cordis 的依赖、作用域、服务、配置和资源生命期，不能仅因 npm 下载成功就判定源码兼容。界面采用既定 Vue runtime/h() 和 CSP；原生源码兼容障碍记录为待补契约，不以自定义缩小接口代替目标。

## 当前本方证据

实际源码：`extjs/host.cjs` 的 `load` 使用本地模块路径，当前接收 `{name, description, params, handler}`；`setup` 可登记监听。`extjs/server.cjs` 提供 load/list/call/cancel/dispose/shutdown。`extjs/example/echo.cjs` 是真实本地工具示例，不是完整 DSH 插件包。

本轮在 `extjs` 运行 `node --test`：**16 tests / 16 pass / 0 fail / 0 skip / rc=0**。覆盖加载、重复名称拒绝、坏模块、调用、卸载监听清理、真实子进程协议、取消/迟到帧和宿主收束。仅验证现有自定义工具切片；没有执行插件包安装、UI 贡献、真实模型生成插件或安装包态验收。

管理页面现有前端记录见[插件安装管理页](plugin-manager-2026-10-04.md)，其中明确包安装后端适配未完成，不能拿页面内存桩当作接通。

## 必须闭合的产品验收

1. 手写插件：从模板编写，在本地目录安装，检查兼容性和依赖；桌面与独立 CLI 均能配置、启用并实际调用。
2. 修改本人插件：编辑、测试、重新加载；错误明确，保留可恢复状态，旧版本资源不泄漏。
3. 重启和卸载：本地配置及装配可恢复；卸载撤销工具、监听、界面贡献与所属进程，取消和断连有真实结算。
4. 模型协助：真实模型生成一个插件，经既定授权安装后验证实际结果；不得凭模型叙述判定成功。
5. 无开发环境：完整安装包携带所需扩展运行能力，运行插件不要求用户另装仓颉 SDK、Node 或全局 CLI；TS 源码的构建支持方式需明确并实测，不能承诺无需构建却只提供源码模板。

本地写插件是产品范围，不是已经交付的声明。尚缺本地包管理/DSH 装配契约、完整 Client 接入、两入口与最终安装态证据；公共市场接入不阻塞这条路径。
