# 知识库、自动化、连接页面对齐

2026-10-12；工作分支 refactor/dsh-learning，工作区 UI 增量，非管理业务或安装态交付。

## 修改责任与范围

本批桌面 UI 负责新增 renderer/pages/product-management.ts 与 test-support/product-management-smoke.cjs；共享 app.js、client-slots.ts、product-design.css 只改对应导航、页面装配及样式，不覆盖其他实现。未修改核心、Host、IPC、调度器或凭据格式。

知识库 F11：用户/项目作用域、项目未选择提示、文档标题/正文表单。
自动化 F13：工作目录、当前/最近项目选择、模型中心现有模型、cron、时区、执行权限和任务提示词。目录选择不改变当前会话项目。
连接 F15/F16 及 MCP：SSH/数据库/MCP 分类，地址、端口、数据库类型、传输配置；不收集明文密钥。

三个左侧入口在会话树下方，与扩展并列；页面采用全宽内容区，不显示右侧工作台。返回恢复入口焦点，窄窗入口不可见时聚焦导航开关。跨页面组件以 page key 隔离，防止临时正文串入另一类配置表单。

## 明确未接通

管理服务缺失显示“尚未连接”，不冒充空清单。表单只在内存临时编辑，明确未保存；保存、连接测试、启动等操作禁用，不创建任务、不调用 Shell、不写本地伪业务存储。模型选项只来自已有模型投影，不造演示模型。搜索在真实清单服务接通前禁用。

当前页面交付不等于 F11/F13/F15/F16 的真实读写、索引、检索注入、准时调度、授权和恢复闭环通过。缺口和解锁条件继续沿用 remaining-product-pages 与知识管理契约。

## 验证

独占快照重打包 client-slots 及页面脚本，保留唯一 Vue runtime，CSP 产物检查通过。
正式 Electron/main/preload/既有 Host 运行 product-management-smoke：90 项通过、退出0。涵盖亮暗真实色值、1384/700px、三个入口、全宽隐藏工作台、用户/项目切换、自动化字段、数据库/MCP类型切换、字段边界和返回焦点。

截图12张：apps/desktop/.tmp-test/page-alignment-co2n8tkf/apps/desktop/proof-management-1791812259088。
退出记录：该快照 apps/desktop/management-exit.json。早两轮返回焦点失败记录保留，窄窗导航隐藏后改聚焦可见导航开关，没有删除判据。

已有 Host profileGet method not found 仍出现在 stderr，不属于本批通过项。运行使用 --no-sandbox 视觉探针，不代表默认沙箱、新 Host 重建或安装态通过。本批未提交。

最后补页间草稿隔离检查后，最新102项通过、退出0；截图目录 proof-management-1791812373897，同一私有快照的 management-exit.json 已更新。90项为前一轮读数，不作为最后改动的结果。
## 本轮草稿与模型快捷入口收口

补齐管理页草稿生命周期：按页面、会话和项目隔离；知识用户/项目作用域、SSH/数据库/MCP 类型及 stdio/HTTP 地址分别保存内存草稿。返回页面、切换类型和打开模型中心不丢失已编辑内容。权限、数据库类型、cron 等均绑定草稿，而非仅更新控件外观。知识文件来源增加项目相对路径输入，不假装已读取或导入。

自动化模型入口打开同一设置模型中心，关闭后保留目录与 cron。最近项目通过既有有限 IPC 实际读取；本次既有 Host 返回 -32601 method not found，页面显示失败提示并允许填写路径，这一服务接线不计通过。

最后验证：product-management-smoke.cjs，MANAGEMENT_UI_PASS 134，真实退出码0；亮暗、1384/700px、12张截图。记录位于私有快照 apps/desktop/management-final-exit.json，截图目录 proof-management-final-1791812988033。人工查看 automation-light-1384.png，未见字段横向越界；表单在页面内容区正常纵向滚动。

本次只验桌面 UI 及对应交互。既有 Host、--no-sandbox、私有依赖等前提不变，不能替代新 Host、默认沙箱或安装包验收。未提交；共享文件仍有并发改动，不整文件吞并提交。
## 用户作用域与最近项目读取边界

用户知识内存草稿改为应用级共享，跨会话与项目仍保留；项目知识草稿按实际配置的项目目录隔离。自动化及连接继续按会话/项目隔离。这里仅为未保存编辑状态，不代表知识存储或索引权威数据源。

最近项目回执逐项检查 id/directory/available 类型，失败及非法回执清除旧选项；目录不可用时保留条目说明但禁止选择；组件卸载后的迟到响应不更新旧页面。

专项测试 product-management.test.mjs 4/4，退出0；正式 Electron 运行管理页面冒烟 140项通过，退出0。增加通过真实 Host 切换到磁盘项目会话的检查，验证用户知识保留、新项目不串旧知识、新会话自动化隔离及真实目录初始化。最新证据：私有快照 apps/desktop/management-scope-exit.json、management-unit.log；截图目录 proof-management-scope-1791813227245。

测试依赖从独占目录加载；第一轮测试启动因 Windows ESM 不接受 D: 路径退出1，改为 file URL 后实际4条均通过。公共测试源码仍沿用仓库 esbuild 导入方式，没有写入本机依赖绝对路径。

workspace/recent 在当前源码已有分派，本次既有二进制缺方法，须从统一源码重新构建后验收。知识、自动化、连接管理 RPC 仍无分派，不能开放保存/运行/测试；本批未改 Host 或 core，未提交共享文件。
