# product/ — 产品文档（索引）

> 类别：① 产品文档。本级文档定义**做什么、给谁做、验收口径**，是需求与范围的第一权威。
> 上级索引：[docs/README.md](../README.md)

## 文档清单

| 文档 | 角色 | 状态与说明 |
|---|---|---|
| [`PRD.md`](PRD.md) | 现行产品需求：F01–F21 能力域、授权与真实任务验收要求 | 活跃。含 2026-10-09 进度对账节（三档口径：已实现/真实入口已接通/仍未验证或缺失）；带日期的进度表是历史快照，不是实时真源 |
| [`PRD-tracking.md`](PRD-tracking.md) | F01–F21 **全程跟进台账**：逐域完成/未完成、缺陷登记（P1/P2/已闭合）、平台快照与关键分母读数 | 2026-10-16 建立；同日刷新：D10 根因已定位（Low 标签继承链）、新增 D18（NSIS）/D19（旧 DLL 载荷）。只登记现状与证据，不改需求、不计算完成率；**完成功能或闭合缺陷必须同批更新**（AGENTS.md「文档同步规则」） |
| [`platform-and-distribution.md`](platform-and-distribution.md) | 平台支持矩阵、npm/GitHub 分发、安装渠道与证据边界 | 2026-10-13 用户决策；**支持目标与已验证状态分开登记**；不等于全平台已发布 |
| [`desktop-design-standard.md`](desktop-design-standard.md) | 桌面布局与品牌规范（兼②设计文档） | 2026-10-03 起草，引用旧基线；使用时结合 PRD 复核，进度以 PRD 为准 |

## 使用规则

1. **需求变更只进 PRD 或本目录专项文**，不改 evidence/ 与 plans/ 里的历史记录；
2. 任何"已完成/已支持"的宣称必须绑定：提交、入口、平台、实际证据四要素（见 PRD 顶部口径）；
3. 平台/分发口径变更时，同步更新 `platform-and-distribution.md`，并在 [docs/README.md](../README.md) 维护记录追加一行；
4. **完成功能或闭合缺陷时，同批更新 [`PRD-tracking.md`](PRD-tracking.md) 对应 Fxx 行**：改状态、补事实、列缺口；缺陷闭合保留历史行并附证据（详见 AGENTS.md「文档同步规则」）。

## 相关

- 设计与契约：[`../plans/README.md`](../plans/README.md)、[`../superpowers/README.md`](../superpowers/README.md)
- 验收与证据：[`../qa/README.md`](../qa/README.md)、[`../evidence/README.md`](../evidence/README.md)
