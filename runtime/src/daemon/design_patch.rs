use std::collections::HashSet;

use chrono::Utc;
use serde::{Deserialize, Serialize};

use super::design::{UiDocument, UiNode};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UiDocumentPatch {
    pub schema_version: String,
    pub base_version: u64,
    pub summary: String,
    #[serde(default)]
    pub operations: Vec<UiPatchOperation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UiPatchOperation {
    #[serde(rename = "type")]
    pub operation_type: String,
    #[serde(default)]
    pub node_id: Option<String>,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub index: Option<usize>,
    #[serde(default)]
    pub new_node_id: Option<String>,
    #[serde(default)]
    pub width: Option<String>,
    #[serde(default)]
    pub height: Option<String>,
    #[serde(default)]
    pub patch: Option<serde_json::Map<String, serde_json::Value>>,
    #[serde(default)]
    pub interactions: Option<Vec<serde_json::Value>>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub value: Option<String>,
    #[serde(default)]
    pub locked: Option<bool>,
    #[serde(default)]
    pub node: Option<UiNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UiPatchChange {
    pub operation: String,
    pub node_id: Option<String>,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UiPatchProposal {
    pub patch: UiDocumentPatch,
    pub changes: Vec<UiPatchChange>,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UiCheckFinding {
    pub id: String,
    pub severity: String,
    pub message: String,
    pub node_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UiCheckReport {
    pub checked_version: u64,
    pub passed: bool,
    pub findings: Vec<UiCheckFinding>,
    pub checked_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UiDocumentVersion {
    pub version: u64,
    pub document: UiDocument,
    pub confirmed_at: String,
    pub summary: String,
}

pub fn validate_patch(patch: &UiDocumentPatch) -> Result<(), String> {
    if patch.schema_version != "sacode-ui-patch/v1" {
        return Err("unsupported UI patch schema".to_string());
    }
    if patch.operations.is_empty() {
        return Err("UI patch must contain at least one operation".to_string());
    }
    if patch.operations.len() > 100 {
        return Err("UI patch cannot contain more than 100 operations".to_string());
    }
    for operation in &patch.operations {
        if !matches!(
            operation.operation_type.as_str(),
            "move-node"
                | "resize-node"
                | "set-layout"
                | "set-content"
                | "set-appearance"
                | "set-props"
                | "set-interactions"
                | "set-token"
                | "set-node-meta"
                | "insert-node"
                | "duplicate-node"
                | "delete-node"
        ) {
            return Err(format!(
                "unsupported UI patch operation: {}",
                operation.operation_type
            ));
        }
    }
    Ok(())
}

pub fn apply_patch(document: &UiDocument, patch: &UiDocumentPatch) -> Result<UiDocument, String> {
    validate_patch(patch)?;
    if patch.base_version != document.version {
        return Err(format!(
            "UI patch version conflict: expected {}, current {}",
            patch.base_version, document.version
        ));
    }
    if document.status == "confirmed" {
        return Err("confirmed UI document is immutable; create a new draft first".to_string());
    }

    let mut next = document.clone();
    for operation in &patch.operations {
        apply_operation(&mut next, operation)?;
    }
    validate_document_ids(&next)?;
    let report = check_ui_document(&next);
    if let Some(blocker) = report
        .findings
        .iter()
        .find(|item| item.severity == "blocker")
    {
        return Err(blocker.message.clone());
    }
    next.version = document.version.saturating_add(1);
    next.status = "draft".to_string();
    next.updated_at = Utc::now().to_rfc3339();
    Ok(next)
}

pub fn summarize_patch(patch: &UiDocumentPatch) -> Vec<UiPatchChange> {
    patch
        .operations
        .iter()
        .map(|operation| UiPatchChange {
            operation: operation.operation_type.clone(),
            node_id: operation.node_id.clone(),
            description: describe_operation(operation),
        })
        .collect()
}

pub fn check_ui_document(document: &UiDocument) -> UiCheckReport {
    let mut findings = Vec::new();
    if document.pages.is_empty() {
        findings.push(finding(
            "pages-empty",
            "blocker",
            "UIDocument 至少需要一个页面",
            None,
        ));
    }
    if document.target.viewports.is_empty() {
        findings.push(finding(
            "viewports-empty",
            "blocker",
            "TargetSurface 至少需要一个视口",
            None,
        ));
    }
    if let Err(message) = validate_document_ids(document) {
        findings.push(finding("node-ids", "blocker", &message, None));
    }
    for page in &document.pages {
        inspect_node(&page.root, &mut findings);
    }
    inspect_global_value(&document.tokens, "tokens", &mut findings);
    inspect_global_value(
        &serde_json::Value::Array(document.flows.clone()),
        "flows",
        &mut findings,
    );
    let state_names = collect_state_names(document);
    for state in ["loading", "empty", "error"] {
        if !state_names.contains(state) {
            findings.push(finding(
                &format!("state-{state}-missing"),
                "warning",
                &format!("尚未定义 {state} 状态"),
                None,
            ));
        }
    }
    if document.flows.is_empty() {
        findings.push(finding(
            "flows-empty",
            "warning",
            "尚未定义页面流程；单页静态界面可忽略",
            None,
        ));
    }
    let passed = !findings.iter().any(|item| item.severity == "blocker");
    UiCheckReport {
        checked_version: document.version,
        passed,
        findings,
        checked_at: Utc::now().to_rfc3339(),
    }
}

pub fn extract_json_payload(text: &str) -> Result<&str, String> {
    let trimmed = text.trim();
    if trimmed.starts_with('{') && trimmed.ends_with('}') {
        return Ok(trimmed);
    }
    if let Some(start) = trimmed.find("```json") {
        let rest = &trimmed[start + 7..];
        if let Some(end) = rest.find("```") {
            return Ok(rest[..end].trim());
        }
    }
    let start = trimmed
        .find('{')
        .ok_or_else(|| "model response did not contain a JSON object".to_string())?;
    let end = trimmed
        .rfind('}')
        .ok_or_else(|| "model response did not contain a complete JSON object".to_string())?;
    Ok(&trimmed[start..=end])
}

fn apply_operation(document: &mut UiDocument, operation: &UiPatchOperation) -> Result<(), String> {
    match operation.operation_type.as_str() {
        "move-node" => move_node(
            document,
            required(&operation.node_id, "node_id")?,
            required(&operation.parent_id, "parent_id")?,
            operation.index.unwrap_or(usize::MAX),
        ),
        "resize-node" => {
            let node = editable_node_mut(document, required(&operation.node_id, "node_id")?)?;
            let layout = object_mut(&mut node.layout, "layout")?;
            set_optional_string(layout, "width", operation.width.as_deref());
            set_optional_string(layout, "height", operation.height.as_deref());
            Ok(())
        }
        "set-layout" | "set-content" | "set-appearance" | "set-props" => {
            let patch = operation
                .patch
                .as_ref()
                .ok_or_else(|| "patch is required".to_string())?;
            let node = editable_node_mut(document, required(&operation.node_id, "node_id")?)?;
            let target = match operation.operation_type.as_str() {
                "set-layout" => &mut node.layout,
                "set-content" => &mut node.content,
                "set-appearance" => &mut node.appearance,
                _ => &mut node.props,
            };
            apply_object_patch(object_mut(target, "node property")?, patch);
            Ok(())
        }
        "set-interactions" => {
            let node = editable_node_mut(document, required(&operation.node_id, "node_id")?)?;
            node.interactions = operation.interactions.clone().unwrap_or_default();
            Ok(())
        }
        "set-token" => set_token(
            &mut document.tokens,
            required(&operation.name, "name")?,
            operation.value.as_deref().unwrap_or_default(),
        ),
        "set-node-meta" => {
            let node = find_node_mut(document, required(&operation.node_id, "node_id")?)
                .ok_or_else(|| "UI node not found".to_string())?;
            if let Some(name) = &operation.name {
                node.name = name.clone();
            }
            if let Some(locked) = operation.locked {
                node.locked = locked;
            }
            Ok(())
        }
        "insert-node" => {
            let candidate = operation
                .node
                .clone()
                .ok_or_else(|| "node is required".to_string())?;
            assert_candidate_ids(document, &candidate)?;
            let parent = editable_node_mut(document, required(&operation.parent_id, "parent_id")?)?;
            if !can_contain_children(parent) {
                return Err("target node cannot contain children".to_string());
            }
            let index = operation
                .index
                .unwrap_or(parent.children.len())
                .min(parent.children.len());
            parent.children.insert(index, candidate);
            Ok(())
        }
        "duplicate-node" => duplicate_node(
            document,
            required(&operation.node_id, "node_id")?,
            required(&operation.new_node_id, "new_node_id")?,
        ),
        "delete-node" => delete_node(document, required(&operation.node_id, "node_id")?),
        _ => Err("unsupported UI patch operation".to_string()),
    }
}

fn move_node(
    document: &mut UiDocument,
    node_id: &str,
    parent_id: &str,
    index: usize,
) -> Result<(), String> {
    if node_id == parent_id {
        return Err("node cannot move into itself".to_string());
    }
    let source = find_node(document, node_id).ok_or_else(|| "UI node not found".to_string())?;
    if source.locked {
        return Err("locked node cannot be moved".to_string());
    }
    if contains_node(source, parent_id) {
        return Err("node cannot move into its descendant".to_string());
    }
    let source_parent_id =
        find_parent_id(document, node_id).ok_or_else(|| "root node cannot be moved".to_string())?;
    if find_node(document, &source_parent_id).is_some_and(|node| node.locked) {
        return Err("locked container structure cannot be modified".to_string());
    }
    if find_node(document, parent_id).is_some_and(|node| node.locked) {
        return Err("locked container structure cannot be modified".to_string());
    }
    let removed = remove_child(document, &source_parent_id, node_id)?;
    let target =
        find_node_mut(document, parent_id).ok_or_else(|| "target node not found".to_string())?;
    if !can_contain_children(target) {
        return Err("target node cannot contain children".to_string());
    }
    target
        .children
        .insert(index.min(target.children.len()), removed);
    Ok(())
}

fn duplicate_node(
    document: &mut UiDocument,
    node_id: &str,
    new_node_id: &str,
) -> Result<(), String> {
    let parent_id = find_parent_id(document, node_id)
        .ok_or_else(|| "root node cannot be duplicated".to_string())?;
    if find_node(document, &parent_id).is_some_and(|node| node.locked) {
        return Err("locked container structure cannot be modified".to_string());
    }
    let source = find_node(document, node_id).ok_or_else(|| "UI node not found".to_string())?;
    if source.locked {
        return Err("locked node cannot be duplicated".to_string());
    }
    let mut duplicate = source.clone();
    rewrite_ids(&mut duplicate, new_node_id);
    assert_candidate_ids(document, &duplicate)?;
    let parent =
        find_node_mut(document, &parent_id).ok_or_else(|| "parent node not found".to_string())?;
    let index = parent
        .children
        .iter()
        .position(|node| node.id == node_id)
        .unwrap_or(parent.children.len());
    parent.children.insert(index + 1, duplicate);
    Ok(())
}

fn delete_node(document: &mut UiDocument, node_id: &str) -> Result<(), String> {
    let parent_id = find_parent_id(document, node_id)
        .ok_or_else(|| "root node cannot be deleted".to_string())?;
    if find_node(document, &parent_id).is_some_and(|node| node.locked) {
        return Err("locked container structure cannot be modified".to_string());
    }
    if find_node(document, node_id).is_some_and(|node| node.locked) {
        return Err("locked node cannot be deleted".to_string());
    }
    remove_child(document, &parent_id, node_id).map(|_| ())
}

fn inspect_node(node: &UiNode, findings: &mut Vec<UiCheckFinding>) {
    inspect_value(&node.content, node, findings);
    inspect_value(&node.layout, node, findings);
    inspect_value(&node.appearance, node, findings);
    inspect_value(&node.props, node, findings);
    inspect_value(&node.states, node, findings);
    inspect_value(
        &serde_json::Value::Array(node.interactions.clone()),
        node,
        findings,
    );
    for child in &node.children {
        inspect_node(child, findings);
    }
}

fn inspect_value(value: &serde_json::Value, node: &UiNode, findings: &mut Vec<UiCheckFinding>) {
    if contains_unsafe_value(value) {
        findings.push(finding(
            "unsafe-style",
            "blocker",
            "节点包含不允许的脚本或外部资源样式值",
            Some(node.id.clone()),
        ));
    }
}

fn inspect_global_value(
    value: &serde_json::Value,
    label: &str,
    findings: &mut Vec<UiCheckFinding>,
) {
    if contains_unsafe_value(value) {
        findings.push(finding(
            &format!("unsafe-{label}"),
            "blocker",
            &format!("{label} 包含不允许的脚本或外部资源值"),
            None,
        ));
    }
}

fn contains_unsafe_value(value: &serde_json::Value) -> bool {
    let serialized = value.to_string().to_ascii_lowercase();
    [
        "javascript:",
        "expression(",
        "@import",
        "url(",
        "<script",
        "onerror=",
        "onload=",
    ]
    .iter()
    .any(|item| serialized.contains(item))
}

fn collect_state_names(document: &UiDocument) -> HashSet<String> {
    let mut names = HashSet::new();
    for page in &document.pages {
        collect_node_state_names(&page.root, &mut names);
    }
    names
}

fn collect_node_state_names(node: &UiNode, names: &mut HashSet<String>) {
    if let Some(states) = node.states.as_object() {
        names.extend(states.keys().map(|key| key.to_ascii_lowercase()));
    }
    for child in &node.children {
        collect_node_state_names(child, names);
    }
}

fn validate_document_ids(document: &UiDocument) -> Result<(), String> {
    let mut ids = HashSet::new();
    for page in &document.pages {
        collect_unique_ids(&page.root, &mut ids)?;
    }
    Ok(())
}

fn collect_unique_ids(node: &UiNode, ids: &mut HashSet<String>) -> Result<(), String> {
    if node.id.trim().is_empty() {
        return Err("UI node id cannot be empty".to_string());
    }
    if !ids.insert(node.id.clone()) {
        return Err(format!("duplicate UI node id: {}", node.id));
    }
    for child in &node.children {
        collect_unique_ids(child, ids)?;
    }
    Ok(())
}

fn assert_candidate_ids(document: &UiDocument, candidate: &UiNode) -> Result<(), String> {
    let mut existing = HashSet::new();
    for page in &document.pages {
        collect_ids(&page.root, &mut existing);
    }
    let mut candidate_ids = HashSet::new();
    collect_candidate_ids(candidate, &existing, &mut candidate_ids)
}

fn collect_ids(node: &UiNode, ids: &mut HashSet<String>) {
    ids.insert(node.id.clone());
    for child in &node.children {
        collect_ids(child, ids);
    }
}

fn collect_candidate_ids(
    node: &UiNode,
    existing: &HashSet<String>,
    ids: &mut HashSet<String>,
) -> Result<(), String> {
    if existing.contains(&node.id) || !ids.insert(node.id.clone()) {
        return Err(format!("UI node id already exists: {}", node.id));
    }
    for child in &node.children {
        collect_candidate_ids(child, existing, ids)?;
    }
    Ok(())
}

fn find_node<'a>(document: &'a UiDocument, node_id: &str) -> Option<&'a UiNode> {
    document
        .pages
        .iter()
        .find_map(|page| find_in_tree(&page.root, node_id))
}

fn find_node_mut<'a>(document: &'a mut UiDocument, node_id: &str) -> Option<&'a mut UiNode> {
    document
        .pages
        .iter_mut()
        .find_map(|page| find_in_tree_mut(&mut page.root, node_id))
}

fn editable_node_mut<'a>(
    document: &'a mut UiDocument,
    node_id: &str,
) -> Result<&'a mut UiNode, String> {
    let node = find_node_mut(document, node_id).ok_or_else(|| "UI node not found".to_string())?;
    if node.locked {
        return Err("locked node cannot be edited".to_string());
    }
    Ok(node)
}

fn find_in_tree<'a>(node: &'a UiNode, node_id: &str) -> Option<&'a UiNode> {
    if node.id == node_id {
        return Some(node);
    }
    node.children
        .iter()
        .find_map(|child| find_in_tree(child, node_id))
}

fn find_in_tree_mut<'a>(node: &'a mut UiNode, node_id: &str) -> Option<&'a mut UiNode> {
    if node.id == node_id {
        return Some(node);
    }
    node.children
        .iter_mut()
        .find_map(|child| find_in_tree_mut(child, node_id))
}

fn find_parent_id(document: &UiDocument, node_id: &str) -> Option<String> {
    document
        .pages
        .iter()
        .find_map(|page| find_parent_in_tree(&page.root, node_id))
}

fn find_parent_in_tree(node: &UiNode, node_id: &str) -> Option<String> {
    if node.children.iter().any(|child| child.id == node_id) {
        return Some(node.id.clone());
    }
    node.children
        .iter()
        .find_map(|child| find_parent_in_tree(child, node_id))
}

fn remove_child(
    document: &mut UiDocument,
    parent_id: &str,
    node_id: &str,
) -> Result<UiNode, String> {
    let parent =
        find_node_mut(document, parent_id).ok_or_else(|| "parent node not found".to_string())?;
    let index = parent
        .children
        .iter()
        .position(|node| node.id == node_id)
        .ok_or_else(|| "child node not found".to_string())?;
    Ok(parent.children.remove(index))
}

fn contains_node(node: &UiNode, node_id: &str) -> bool {
    node.id == node_id
        || node
            .children
            .iter()
            .any(|child| contains_node(child, node_id))
}

fn can_contain_children(node: &UiNode) -> bool {
    !matches!(
        node.node_type.as_str(),
        "input" | "textarea" | "divider" | "spacer" | "image" | "table"
    )
}

fn rewrite_ids(node: &mut UiNode, root_id: &str) {
    node.id = root_id.to_string();
    node.name = format!("{} 副本", node.name);
    node.locked = false;
    for (index, child) in node.children.iter_mut().enumerate() {
        rewrite_ids(child, &format!("{}-{}", root_id, index + 1));
    }
}

fn set_token(tokens: &mut serde_json::Value, name: &str, value: &str) -> Result<(), String> {
    let path: Vec<&str> = name
        .split('.')
        .filter(|part| !part.trim().is_empty())
        .collect();
    if path.is_empty() {
        return Err("token name cannot be empty".to_string());
    }
    let mut target = object_mut(tokens, "tokens")?;
    for segment in &path[..path.len() - 1] {
        let entry = target
            .entry((*segment).to_string())
            .or_insert_with(|| serde_json::Value::Object(Default::default()));
        target = object_mut(entry, "token namespace")?;
    }
    let key = path[path.len() - 1];
    if value.is_empty() {
        target.remove(key);
    } else {
        target.insert(
            key.to_string(),
            serde_json::Value::String(value.to_string()),
        );
    }
    Ok(())
}

fn object_mut<'a>(
    value: &'a mut serde_json::Value,
    label: &str,
) -> Result<&'a mut serde_json::Map<String, serde_json::Value>, String> {
    if value.is_null() {
        *value = serde_json::Value::Object(Default::default());
    }
    value
        .as_object_mut()
        .ok_or_else(|| format!("{label} must be an object"))
}

fn apply_object_patch(
    target: &mut serde_json::Map<String, serde_json::Value>,
    patch: &serde_json::Map<String, serde_json::Value>,
) {
    for (key, value) in patch {
        if value.is_null() || value.as_str() == Some("") {
            target.remove(key);
        } else {
            target.insert(key.clone(), value.clone());
        }
    }
}

fn set_optional_string(
    target: &mut serde_json::Map<String, serde_json::Value>,
    key: &str,
    value: Option<&str>,
) {
    if let Some(value) = value {
        if value.is_empty() {
            target.remove(key);
        } else {
            target.insert(
                key.to_string(),
                serde_json::Value::String(value.to_string()),
            );
        }
    }
}

fn required<'a>(value: &'a Option<String>, label: &str) -> Result<&'a str, String> {
    value
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("{label} is required"))
}

fn describe_operation(operation: &UiPatchOperation) -> String {
    let target = operation.node_id.as_deref().unwrap_or("document");
    match operation.operation_type.as_str() {
        "move-node" => format!(
            "移动节点 {target} 到 {}",
            operation.parent_id.as_deref().unwrap_or("unknown")
        ),
        "insert-node" => format!(
            "向 {} 添加节点",
            operation.parent_id.as_deref().unwrap_or("unknown")
        ),
        "duplicate-node" => format!("复制节点 {target}"),
        "delete-node" => format!("删除节点 {target}"),
        "set-token" => format!(
            "更新 Token {}",
            operation.name.as_deref().unwrap_or("unknown")
        ),
        other => format!("对节点 {target} 执行 {other}"),
    }
}

fn finding(id: &str, severity: &str, message: &str, node_id: Option<String>) -> UiCheckFinding {
    UiCheckFinding {
        id: id.to_string(),
        severity: severity.to_string(),
        message: message.to_string(),
        node_id,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::daemon::design::{TargetSurface, UiPage, UiViewport};

    fn node(id: &str, children: Vec<UiNode>) -> UiNode {
        UiNode {
            id: id.to_string(),
            name: id.to_string(),
            node_type: "container".to_string(),
            content: serde_json::json!({}),
            props: serde_json::json!({}),
            layout: serde_json::json!({}),
            appearance: serde_json::json!({}),
            responsive: vec![],
            states: serde_json::json!({}),
            interactions: vec![],
            children,
            locked: false,
        }
    }

    fn document() -> UiDocument {
        UiDocument {
            schema_version: "sacode-ui/v1".to_string(),
            id: "ui-test".to_string(),
            name: "Test".to_string(),
            target: TargetSurface {
                platform: "responsive-web".to_string(),
                input_modes: vec!["mouse".to_string()],
                viewports: vec![UiViewport {
                    id: "desktop".to_string(),
                    name: "Desktop".to_string(),
                    width: 1440,
                    height: 900,
                }],
                density: "comfortable".to_string(),
                orientation: "adaptive".to_string(),
                capabilities: vec![],
            },
            pages: vec![UiPage {
                id: "page".to_string(),
                name: "Page".to_string(),
                route_intent: Some("/".to_string()),
                root: node("root", vec![node("child", vec![])]),
            }],
            reusable_components: vec![],
            tokens: serde_json::json!({}),
            assets: vec![],
            flows: vec![],
            version: 1,
            status: "draft".to_string(),
            created_at: Utc::now().to_rfc3339(),
            updated_at: Utc::now().to_rfc3339(),
        }
    }

    #[test]
    fn applies_content_patch_and_increments_version() {
        let patch = UiDocumentPatch {
            schema_version: "sacode-ui-patch/v1".to_string(),
            base_version: 1,
            summary: "edit".to_string(),
            operations: vec![UiPatchOperation {
                operation_type: "set-content".to_string(),
                node_id: Some("child".to_string()),
                parent_id: None,
                index: None,
                new_node_id: None,
                width: None,
                height: None,
                patch: Some(serde_json::Map::from_iter([(
                    "text".to_string(),
                    serde_json::json!("Changed"),
                )])),
                interactions: None,
                name: None,
                value: None,
                locked: None,
                node: None,
            }],
        };
        let result = apply_patch(&document(), &patch).expect("patch");
        assert_eq!(result.version, 2);
        assert_eq!(
            find_node(&result, "child").unwrap().content["text"],
            "Changed"
        );
    }

    #[test]
    fn rejects_version_conflict_and_confirmed_document() {
        let mut patch = UiDocumentPatch {
            schema_version: "sacode-ui-patch/v1".to_string(),
            base_version: 0,
            summary: "x".to_string(),
            operations: vec![UiPatchOperation {
                operation_type: "delete-node".to_string(),
                node_id: Some("child".to_string()),
                parent_id: None,
                index: None,
                new_node_id: None,
                width: None,
                height: None,
                patch: None,
                interactions: None,
                name: None,
                value: None,
                locked: None,
                node: None,
            }],
        };
        assert!(apply_patch(&document(), &patch)
            .unwrap_err()
            .contains("version conflict"));
        patch.base_version = 1;
        let mut confirmed = document();
        confirmed.status = "confirmed".to_string();
        assert!(apply_patch(&confirmed, &patch)
            .unwrap_err()
            .contains("immutable"));
    }

    #[test]
    fn check_blocks_unsafe_values() {
        let mut document = document();
        find_node_mut(&mut document, "child").unwrap().appearance =
            serde_json::json!({"background":"url(javascript:alert(1))"});
        let report = check_ui_document(&document);
        assert!(!report.passed);
        assert!(report
            .findings
            .iter()
            .any(|finding| finding.id == "unsafe-style"));
    }
}
