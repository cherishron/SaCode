//! 工具执行拦截器实现集
//!
//! 默认拦截器（等价于原 `sandbox_guard` 行为）见 [`default`] 模块。
//! 后续可按 Profile 挂载自定义拦截器组合（对比文档 §3.2 第三步）。

pub mod default;
