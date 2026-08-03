pub mod discovery;
mod host;
pub mod loader;
pub mod registry;

pub use discovery::{discover_wasm_plugins, load_wasm_plugin_dir};
pub use host::{PluginCall, PluginFunction, PluginHost, PluginResult, PluginSpec};
pub use loader::PluginLoader;
pub use registry::{PluginDescriptor, PluginKind, PluginRegistry};
