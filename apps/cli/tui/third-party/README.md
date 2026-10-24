# 第三方展示代码与许可

`src/markdown.mjs` 的块级 Markdown 解析流程修改自：

- 项目：Google Gemini CLI
- 固定版本：`a3dd9f8c7bcb495a46d0b505b6f179996ccd8332`
- 文件：`packages/cli/src/ui/utils/MarkdownDisplay.tsx`
- 原作者声明：Copyright 2025 Google LLC
- 许可证：Apache-2.0，完整文本见本目录 `Apache-2.0.txt`；分发产物同带该文本和本说明。
- 修改：移除 TypeScript、Google core/settings/hooks；适配 React18/Ink5 与 SaCode 主题；代码/行内/表格为本仓安全渲染适配，不执行 HTML、链接、ANSI；表格结束行继续解析；流式未闭合代码围栏保持可读。代码高亮与完整 CommonMark 一致性尚未实现。

已核上游固定 Git 树未列根级 NOTICE；不代表第三方依赖都无 NOTICE。此处只移植上述文件的解析流程，不打包其 SDK、认证、工具引擎或其余依赖。其他 SaCode 文件仍按本仓许可证；不能将 Google 版权移除或误称整包只含单一许可证。

## 随 bundle 内联依赖的许可

构建按 Rollup 模块记录收集实际内联包的根级 LICENSE/NOTICE/COPYING，生成 `dist/third-party/bundled-packages.json` 并随主包分发。未知缺文件会阻断构建，不自动套模板。两个已核例外：

- `yoga-layout@3.2.1` npm 包无 LICENSE，补带 [facebook/yoga v3.2.1/LICENSE](https://github.com/facebook/yoga/blob/v3.2.1/LICENSE)，原文在 `yoga-layout-3.2.1/LICENSE.txt`。
- `@alcalzone/ansi-tokenize@0.1.3` npm 元数据与固定源码 `d9313397d7fd91b0da5e1aed7445830911622929` 声明 MIT，但无 LICENSE。补带同项目作者在后续固定提交 [5da59bc…/LICENSE](https://github.com/AlCalzone/ansi-tokenize/blob/5da59bc5ac94972bdc92ba8fea34ff6ea1653a0c/LICENSE) 发布的 MIT 原文；明确它不是从 0.1.3 tarball 提取的文件，保留作者现行版权年份，不伪称历史文件。

轻量代码着色只覆盖 JS/TS/Python/Bash/JSON/CJ 常见 token；未知语法原文回退，不宣称完整语言解析或 CommonMark 一致性。
