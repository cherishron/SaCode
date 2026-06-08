use std::{
    env,
    path::Path,
    sync::OnceLock,
    time::{SystemTime, UNIX_EPOCH},
};

use sqlx::{Pool, Sqlite, sqlite::SqlitePoolOptions};

use crate::models::NotificationResponse;

pub(crate) async fn connect_sqlite(database_path: &str) -> Result<Pool<Sqlite>, sqlx::Error> {
    let database_url = format!("sqlite:{}", database_path);

    SqlitePoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await
}

pub(crate) fn default_notifications() -> Vec<NotificationResponse> {
    vec![
        NotificationResponse {
            id: "notif-rust-1".to_string(),
            r#type: "system",
            priority: "normal",
            title: "rust api 已接管部分只读接口".to_string(),
            message: "dashboard、models、settings、notifications 已进入 rust 重构阶段。"
                .to_string(),
            data: serde_json::json!({ "link": "/settings" }),
            read: false,
            created_at: iso_timestamp_now(),
            expires_at: None,
        },
        NotificationResponse {
            id: "notif-rust-2".to_string(),
            r#type: "info",
            priority: "low",
            title: "当前通知为内存示例数据".to_string(),
            message: "后续将迁移为 rust gateway 统一推送。".to_string(),
            data: serde_json::json!({}),
            read: true,
            created_at: iso_timestamp_now(),
            expires_at: None,
        },
    ]
}

pub(crate) fn resolve_database_path() -> Option<String> {
    if let Ok(path) = env::var("DATABASE_PATH") {
        if Path::new(&path).exists() {
            return Some(path);
        }
    }

    let candidates = [
        "/workspace/data/SACODE.db",
        "/workspace/data/sacode.db",
        "/workspace/packages/database/data/SACODE.db",
        "/workspace/packages/database/data/sacode.db",
    ];

    candidates
        .iter()
        .find(|candidate| Path::new(candidate).exists())
        .map(|value| (*value).to_string())
}

pub(crate) fn iso_id_suffix() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time before unix epoch");
    format!("{}{:03}", now.as_secs(), now.subsec_millis())
}

pub(crate) fn iso_timestamp_now() -> String {
    static BASE_INSTANT: OnceLock<(u64, u32)> = OnceLock::new();

    let (base_secs, base_nanos) = *BASE_INSTANT.get_or_init(|| {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch");
        (now.as_secs(), now.subsec_nanos())
    });

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time before unix epoch");
    let elapsed_secs = now.as_secs().saturating_sub(base_secs);
    let elapsed_nanos = now.subsec_nanos().saturating_sub(base_nanos);

    format!(
        "{}.{:09}Z",
        base_secs.saturating_add(elapsed_secs),
        elapsed_nanos
    )
}
