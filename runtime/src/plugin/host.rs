use anyhow::Result;
use extism::{Manifest, Plugin, Wasm};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginSpec {
    pub name: String,
    pub version: String,
    pub description: String,
    pub wasm_path: String,
    pub functions: Vec<PluginFunction>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginFunction {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
    pub output_schema: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginCall {
    pub function: String,
    pub input: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginResult {
    pub output: serde_json::Value,
    pub success: bool,
    pub error: Option<String>,
}

pub struct PluginHost {
    plugins: Vec<(PluginSpec, Plugin)>,
}

impl PluginHost {
    pub fn new() -> Self {
        Self {
            plugins: Vec::new(),
        }
    }

    pub fn load(&mut self, spec: PluginSpec) -> Result<()> {
        let wasm_path = Path::new(&spec.wasm_path);

        if !wasm_path.exists() {
            anyhow::bail!("WASM file not found: {}", spec.wasm_path);
        }

        let wasm = Wasm::file(wasm_path);
        let manifest = Manifest::new([wasm]);

        let plugin = Plugin::new(manifest, [], true)?;
        self.plugins.push((spec, plugin));

        Ok(())
    }

    pub fn call(&mut self, plugin_name: &str, call: PluginCall) -> Result<PluginResult> {
        let entry = self
            .plugins
            .iter_mut()
            .find(|(spec, _)| spec.name == plugin_name);

        if entry.is_none() {
            return Ok(PluginResult {
                output: serde_json::json!(null),
                success: false,
                error: Some(format!("Plugin not found: {}", plugin_name)),
            });
        }

        let (spec, plugin) = entry.unwrap();

        let func = spec.functions.iter().find(|f| f.name == call.function);

        if func.is_none() {
            return Ok(PluginResult {
                output: serde_json::json!(null),
                success: false,
                error: Some(format!(
                    "Function not found: {} in {}",
                    call.function, plugin_name
                )),
            });
        }

        let input_json = serde_json::to_string(&call.input)?;
        let result = plugin.call::<String, String>(call.function.as_str(), input_json);

        match result {
            Ok(output_str) => {
                let output: serde_json::Value = serde_json::from_str(&output_str)
                    .unwrap_or_else(|_| serde_json::json!(output_str));

                Ok(PluginResult {
                    output,
                    success: true,
                    error: None,
                })
            }
            Err(e) => Ok(PluginResult {
                output: serde_json::json!(null),
                success: false,
                error: Some(e.to_string()),
            }),
        }
    }

    pub fn list(&self) -> Vec<&PluginSpec> {
        self.plugins.iter().map(|(spec, _)| spec).collect()
    }

    pub fn unload(&mut self, plugin_name: &str) -> Result<()> {
        let idx = self
            .plugins
            .iter()
            .position(|(spec, _)| spec.name == plugin_name);

        if let Some(i) = idx {
            self.plugins.remove(i);
        }

        Ok(())
    }
}

impl Default for PluginHost {
    fn default() -> Self {
        Self::new()
    }
}
