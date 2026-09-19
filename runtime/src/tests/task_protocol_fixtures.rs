use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use sacode_kernel::{ExecutionMode, TaskCreateRequest, TaskSnapshot, TASK_PROTOCOL_VERSION};

/// 与 VSCode 扩展共用的任务协议 JSON fixture 目录。
///
/// 两侧必须使用同一组 fixture：Rust 侧验证 serde 序列化/校验语义，
/// TypeScript 侧验证运行时校验语义，任何一侧语义漂移都会在这里暴露。
fn fixture_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../interfaces/vscode/test/fixtures/task-protocol")
}

fn read_fixtures(subdir: &str) -> Vec<(String, serde_json::Value)> {
    let dir = fixture_dir().join(subdir);
    let mut entries: Vec<_> = fs::read_dir(&dir)
        .unwrap_or_else(|error| panic!("read fixtures at {}: {error}", dir.display()))
        .filter_map(Result::ok)
        .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "json"))
        .collect();
    entries.sort_by_key(|entry| entry.file_name());

    entries
        .into_iter()
        .map(|entry| {
            let path = entry.path();
            let name = path.file_stem().map_or_else(
                || path.display().to_string(),
                |stem| stem.to_string_lossy().into_owned(),
            );
            let raw = fs::read_to_string(&path)
                .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
            let value = serde_json::from_str(&raw)
                .unwrap_or_else(|error| panic!("parse {}: {error}", path.display()));
            (name, value)
        })
        .collect()
}

/// 键序无关的 JSON 规范化：serde_json 的 Map 顺序取决于编译 feature，
/// 比较语义内容而不是序列化顺序。
fn canonical(value: &serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::Object(map) => {
            let sorted: BTreeMap<String, serde_json::Value> = map
                .iter()
                .map(|(key, item)| (key.clone(), canonical(item)))
                .collect();
            serde_json::Value::Object(sorted.into_iter().collect())
        }
        serde_json::Value::Array(items) => {
            serde_json::Value::Array(items.iter().map(canonical).collect())
        }
        other => other.clone(),
    }
}

#[test]
fn valid_task_protocol_fixtures_roundtrip_without_semantic_drift() {
    let fixtures = read_fixtures("valid");
    assert!(
        fixtures.len() >= 6,
        "expected at least 6 valid fixtures, got {}",
        fixtures.len()
    );

    for (name, value) in fixtures {
        let snapshot: TaskSnapshot = serde_json::from_value(value.clone())
            .unwrap_or_else(|error| panic!("{name}: snapshot must deserialize: {error}"));
        snapshot
            .validate()
            .unwrap_or_else(|error| panic!("{name}: snapshot must validate: {error}"));
        let roundtrip = serde_json::to_value(&snapshot).expect("serialize snapshot");
        assert_eq!(
            canonical(&roundtrip),
            canonical(&value),
            "{name}: round trip drifted"
        );
    }
}

/// 非法 fixture 必须被 serde 反序列化或协议校验拒绝。
fn fixture_is_rejected(value: serde_json::Value) -> bool {
    match serde_json::from_value::<TaskSnapshot>(value) {
        Ok(snapshot) => snapshot.validate().is_err(),
        Err(_) => true,
    }
}

#[test]
fn invalid_task_protocol_fixtures_are_rejected_by_validation() {
    let fixtures = read_fixtures("invalid");
    assert!(
        fixtures.len() >= 8,
        "expected at least 8 invalid fixtures, got {}",
        fixtures.len()
    );

    for (name, value) in fixtures {
        assert!(fixture_is_rejected(value), "{name} must be rejected");
    }
}

#[test]
fn fixtures_use_the_supported_protocol_version() {
    let fixtures = read_fixtures("valid");
    for (name, value) in fixtures {
        assert_eq!(
            value.get("schema_version"),
            Some(&serde_json::json!(TASK_PROTOCOL_VERSION)),
            "{name}: unsupported schema_version"
        );
    }
}

#[test]
fn task_create_request_treats_yolo_as_input_alias_only() {
    let request: TaskCreateRequest = serde_json::from_value(serde_json::json!({
        "schema_version": TASK_PROTOCOL_VERSION,
        "prompt": "inspect the repository",
        "mode": "yolo",
        "source": "vscode",
        "workspace": { "root": "." }
    }))
    .expect("legacy yolo mode stays accepted as input");
    assert_eq!(request.mode, ExecutionMode::Yolo);
    request.validate().expect("request must validate");
    assert_eq!(
        serde_json::to_value(&request).expect("serialize request")["mode"],
        "auto",
        "clients must emit auto, never yolo"
    );
}
