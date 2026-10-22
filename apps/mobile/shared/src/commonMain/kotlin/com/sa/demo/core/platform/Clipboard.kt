package com.sa.demo.core.platform

/**
 * 复制文本到系统剪贴板。
 *
 * 沿用本项目既有的 expect/actual 平台桥（见 `openUrlInBrowser`），
 * 而非 Kuikly Module——Module 需在每个 Pager 的 `createExternalModules()` 注册，
 * 对单个「复制」能力成本过高。
 *
 * @param label 剪贴板条目标签（Android 上用户长按粘贴时可见）
 * @return 是否成功写入。平台不支持时返回 false，调用方据此决定是否提示用户。
 */
expect fun copyToClipboard(label: String, text: String): Boolean
