use super::*;

#[tokio::test]
async fn test_daemon_health_endpoint() {
    let app = create_daemon().await;

    let response = app
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("daemon should respond");

    assert_eq!(response.status(), StatusCode::OK);

    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read body");
    let payload: serde_json::Value = serde_json::from_slice(&body).expect("valid json");

    assert_eq!(payload["status"], "healthy");
    assert_eq!(payload["version"], env!("CARGO_PKG_VERSION"));
}

#[tokio::test]
async fn test_daemon_tools_endpoint_lists_builtin_tools() {
    let app = create_daemon().await;

    let response = app
        .oneshot(
            Request::builder()
                .uri("/tools")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("daemon should respond");

    assert_eq!(response.status(), StatusCode::OK);

    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read body");
    let payload: serde_json::Value = serde_json::from_slice(&body).expect("valid json");
    let tools = payload["tools"].as_array().expect("tools array");

    assert!(tools.iter().any(|tool| tool == "fs.read"));
    assert!(tools.iter().any(|tool| tool == "fs.write"));
    assert!(tools.iter().any(|tool| tool == "shell.exec"));
}

#[tokio::test]
async fn test_daemon_task_lifecycle() {
    let app = create_daemon().await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/task")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"prompt":"分析代码结构","mode":"build"}"#))
                .expect("build request"),
        )
        .await
        .expect("daemon should create task");

    assert_eq!(response.status(), StatusCode::OK);

    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read body");
    let payload: serde_json::Value = serde_json::from_slice(&body).expect("valid json");
    let task_id = payload["task_id"].as_str().expect("task id").to_string();

    assert_eq!(payload["status"], "queued");

    tokio::time::sleep(Duration::from_millis(50)).await;

    let response = app
        .oneshot(
            Request::builder()
                .uri(format!("/task/{}/status", task_id))
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("daemon should return task status");

    assert_eq!(response.status(), StatusCode::OK);

    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read body");
    let payload: serde_json::Value = serde_json::from_slice(&body).expect("valid json");

    assert_eq!(payload["task_id"], task_id);
    assert!(matches!(
        payload["queue_status"].as_str(),
        Some("pending") | Some("ready") | Some("running") | Some("completed") | Some("failed")
    ));
    assert!(payload.get("task_run").is_some());
    if let Some(task_run) = payload.get("task_run") {
        assert_eq!(task_run["source"].as_str(), Some("snapshot"));
    }
    if let Some(task_run_state) = payload
        .get("task_run")
        .and_then(|value| value.get("state"))
        .and_then(|value| value.as_str())
    {
        let expected_queue_status = match task_run_state {
            "Completed" => "completed",
            "Failed" => "failed",
            "WaitingForUser" | "WaitingForApproval" => "running",
            other => panic!("unexpected task_run state: {}", other),
        };
        assert_eq!(
            payload["queue_status"].as_str(),
            Some(expected_queue_status)
        );
    }
}

#[tokio::test]
async fn test_daemon_events_endpoint_streams_sse() {
    let app = create_daemon().await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/events")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("daemon should open event stream");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response
            .headers()
            .get("content-type")
            .and_then(|value| value.to_str().ok()),
        Some("text/event-stream")
    );

    let mut body = response.into_body();

    let create_task = app.oneshot(
        Request::builder()
            .method("POST")
            .uri("/task")
            .header("content-type", "application/json")
            .body(Body::from(r#"{"prompt":"分析代码结构","mode":"build"}"#))
            .expect("build request"),
    );

    let next_frame = tokio::time::timeout(Duration::from_secs(1), body.frame());
    let (_, frame_result) = tokio::join!(create_task, next_frame);

    let frame = frame_result
        .expect("sse frame should arrive")
        .expect("body should yield a frame")
        .expect("frame should be readable");
    let bytes = frame.into_data().expect("sse frame should contain data");
    let text = String::from_utf8_lossy(&bytes);

    assert!(text.contains("event: task_created") || text.contains("event: task_started"));
}

#[tokio::test]
async fn test_daemon_task_events_endpoint_filters_by_task_id() {
    let app = create_daemon().await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/task")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"prompt":"分析代码结构","mode":"build"}"#))
                .expect("build request"),
        )
        .await
        .expect("daemon should create task");

    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read body");
    let payload: serde_json::Value = serde_json::from_slice(&body).expect("valid json");
    let task_id = payload["task_id"].as_str().expect("task id").to_string();

    let response = app
        .oneshot(
            Request::builder()
                .uri(format!("/events/{}", task_id))
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("daemon should open task event stream");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response
            .headers()
            .get("content-type")
            .and_then(|value| value.to_str().ok()),
        Some("text/event-stream")
    );
}

#[tokio::test]
async fn test_daemon_api_stream_endpoint_streams_sse() {
    let app = create_daemon().await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/stream")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("daemon should open api stream");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response
            .headers()
            .get("content-type")
            .and_then(|value| value.to_str().ok()),
        Some("text/event-stream")
    );
}

#[tokio::test]
async fn test_daemon_api_stream_endpoint_supports_task_filter() {
    let app = create_daemon().await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/task")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"prompt":"分析代码结构","mode":"build"}"#))
                .expect("build request"),
        )
        .await
        .expect("daemon should create task");

    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read body");
    let payload: serde_json::Value = serde_json::from_slice(&body).expect("valid json");
    let task_id = payload["task_id"].as_str().expect("task id").to_string();

    let response = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/stream?task_id={}", task_id))
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("daemon should open filtered api stream");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response
            .headers()
            .get("content-type")
            .and_then(|value| value.to_str().ok()),
        Some("text/event-stream")
    );
}

#[tokio::test]
async fn test_daemon_api_stream_task_event_contains_normalized_fields() {
    let app = create_daemon().await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/stream")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("daemon should open api stream");

    let mut body = response.into_body();
    let mut saw_matching_event = false;

    let mut create_task = Some(
        app.clone().oneshot(
            Request::builder()
                .method("POST")
                .uri("/task")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"prompt":"生成一个简单计划","mode":"plan"}"#))
                .expect("build request"),
        ),
    );

    let mut target_task_id: Option<String> = None;

    for _ in 0..20 {
        if target_task_id.is_none() {
            let response = create_task
                .take()
                .expect("create_task future should exist")
                .await
                .expect("daemon should create task");
            let body = to_bytes(response.into_body(), usize::MAX)
                .await
                .expect("read body");
            let payload: serde_json::Value = serde_json::from_slice(&body).expect("valid json");
            target_task_id = payload["task_id"].as_str().map(str::to_string);
        }

        let frame = match tokio::time::timeout(Duration::from_secs(1), body.frame()).await {
            Ok(Some(Ok(frame))) => frame,
            Ok(Some(Err(error))) => panic!("frame should be readable: {}", error),
            Ok(None) => break,
            Err(_) => continue,
        };
        let bytes = frame.into_data().expect("sse frame should contain data");
        let text = String::from_utf8_lossy(&bytes);

        let data_line = match text.lines().find(|line| line.starts_with("data: ")) {
            Some(line) => line,
            None => continue,
        };
        let event_payload: serde_json::Value =
            serde_json::from_str(data_line.trim_start_matches("data: "))
                .expect("valid event payload");

        if target_task_id.as_deref()
            != event_payload
                .get("task_id")
                .and_then(|value| value.as_str())
        {
            continue;
        }

        assert!(event_payload.get("payload").is_some());
        assert!(event_payload.get("event_type").is_some());
        saw_matching_event = true;
        break;
    }

    assert!(saw_matching_event);
}

#[tokio::test]
async fn test_daemon_status_and_result_include_task_run() {
    let app = create_daemon().await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/task")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"prompt":"分析代码结构","mode":"plan"}"#))
                .expect("build request"),
        )
        .await
        .expect("daemon should create task");

    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read body");
    let payload: serde_json::Value = serde_json::from_slice(&body).expect("valid json");
    let task_id = payload["task_id"].as_str().expect("task id").to_string();

    let mut status_payload = serde_json::Value::Null;
    for _ in 0..10 {
        let status_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/task/{}/status", task_id))
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("daemon should return status");
        let status_body = to_bytes(status_response.into_body(), usize::MAX)
            .await
            .expect("read status body");
        status_payload = serde_json::from_slice(&status_body).expect("valid status json");
        if status_payload.get("task_run").is_some() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(status_payload.get("task_run").is_some());

    let mut result_payload = serde_json::Value::Null;
    for _ in 0..10 {
        let result_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/task/{}/result", task_id))
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("daemon should return result");
        let result_body = to_bytes(result_response.into_body(), usize::MAX)
            .await
            .expect("read result body");
        result_payload = serde_json::from_slice(&result_body).expect("valid result json");
        if result_payload.get("task_run").is_some() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(result_payload.get("task_run").is_some());
}

#[tokio::test]
async fn test_task_queue_submit_and_status() {
    let queue = Arc::new(TaskQueue::new(2));

    let task = ScheduledTask::new(
        "test-1".to_string(),
        Task::new("test prompt", ExecutionMode::Build, None),
    );
    let task_id = queue.submit(task).await.expect("submit task");

    let status = queue.status(&task_id).await;
    assert_eq!(status, Some(TaskQueueStatus::Ready));

    let stats = queue.stats().await;
    assert_eq!(stats.ready_count, 1);
}

#[tokio::test]
async fn test_task_executor_emits_task_run_in_completion_event() {
    let queue = Arc::new(TaskQueue::new(1));
    queue
        .submit(ScheduledTask::new(
            "exec-1".to_string(),
            Task::new("生成一个简单计划", ExecutionMode::Plan, None),
        ))
        .await
        .expect("submit task");

    let mut executor = crate::executor::TaskExecutor::new(queue, ToolRegistry::builtin());
    let mut receiver = executor.subscribe();

    executor.run_once().await;
    tokio::time::sleep(Duration::from_millis(50)).await;
    executor.run_once().await;

    let mut saw_completion = false;
    while let Ok(evt) = receiver.try_recv() {
        if evt.event_type == "task_completed" {
            saw_completion = true;
            assert!(evt.data.get("result").is_some());
            let task_run = evt.data.get("task_run").expect("task_run payload");
            assert_eq!(task_run.get("state"), Some(&serde_json::json!("Completed")));
            assert!(task_run.get("output_text").is_some());
        }
    }

    assert!(saw_completion);
}

#[tokio::test]
async fn test_daemon_emit_event_normalizes_payload_shape() {
    let app = create_daemon().await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/stream")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("daemon should open api stream");

    let mut body = response.into_body();

    let create_task = app.oneshot(
        Request::builder()
            .method("POST")
            .uri("/task")
            .header("content-type", "application/json")
            .body(Body::from(r#"{"prompt":"分析代码结构","mode":"build"}"#))
            .expect("build request"),
    );

    let next_frame = tokio::time::timeout(Duration::from_secs(1), body.frame());
    let (_, frame_result) = tokio::join!(create_task, next_frame);

    let frame = frame_result
        .expect("sse frame should arrive")
        .expect("body should yield a frame")
        .expect("frame should be readable");
    let bytes = frame.into_data().expect("sse frame should contain data");
    let text = String::from_utf8_lossy(&bytes);

    assert!(text.contains("event: task_created") || text.contains("event: task_started"));
    assert!(text.contains("\"task_id\":"));
    assert!(text.contains("\"event_type\":"));
    assert!(text.contains("\"timestamp\":"));
    assert!(text.contains("\"payload\":{"));
}

#[tokio::test]
async fn test_task_executor_task_started_event_contains_payload_fields() {
    let queue = Arc::new(TaskQueue::new(1));
    queue
        .submit(ScheduledTask::new(
            "exec-started-1".to_string(),
            Task::new("分析代码结构", ExecutionMode::Build, None),
        ))
        .await
        .expect("submit task");

    let mut executor = crate::executor::TaskExecutor::new(queue, ToolRegistry::builtin());
    let mut receiver = executor.subscribe();

    executor.run_once().await;

    let mut saw_started = false;
    while let Ok(evt) = receiver.try_recv() {
        if evt.event_type == "task_started" {
            saw_started = true;
            assert_eq!(
                evt.data.get("prompt"),
                Some(&serde_json::json!("分析代码结构"))
            );
            assert_eq!(evt.data.get("mode"), Some(&serde_json::json!("build")));
        }
    }

    assert!(saw_started);
}

#[tokio::test]
async fn test_task_queue_priority_ordering() {
    let queue = Arc::new(TaskQueue::new(1));

    let blocker = ScheduledTask::new(
        "blocker".to_string(),
        Task::new("blocker", ExecutionMode::Build, None),
    );
    let blocker_id = queue.submit(blocker).await.expect("submit blocker");

    let low_task = ScheduledTask::new(
        "low-1".to_string(),
        Task::new("low priority", ExecutionMode::Build, None),
    )
    .with_priority(TaskPriority::Low)
    .with_dependencies(vec![blocker_id.clone()]);
    let normal_task = ScheduledTask::new(
        "normal-1".to_string(),
        Task::new("normal priority", ExecutionMode::Build, None),
    )
    .with_priority(TaskPriority::Normal)
    .with_dependencies(vec![blocker_id.clone()]);
    let high_task = ScheduledTask::new(
        "high-1".to_string(),
        Task::new("high priority", ExecutionMode::Build, None),
    )
    .with_priority(TaskPriority::High)
    .with_dependencies(vec![blocker_id.clone()]);
    let urgent_task = ScheduledTask::new(
        "urgent-1".to_string(),
        Task::new("urgent priority", ExecutionMode::Build, None),
    )
    .with_priority(TaskPriority::Urgent)
    .with_dependencies(vec![blocker_id.clone()]);

    queue.submit(low_task.clone()).await.expect("submit low");
    queue
        .submit(normal_task.clone())
        .await
        .expect("submit normal");
    queue.submit(high_task.clone()).await.expect("submit high");
    queue
        .submit(urgent_task.clone())
        .await
        .expect("submit urgent");

    let stats = queue.stats().await;
    assert_eq!(stats.pending_count, 4);
    assert_eq!(stats.ready_count, 1);

    let next = queue.next_ready().await;
    assert!(next.is_some());
    assert_eq!(next.unwrap().id, "blocker");

    queue
        .mark_completed(
            "blocker",
            sacode_kernel::TaskResult::success("blocker".to_string(), "done".to_string(), 0),
            sacode_kernel::TaskRun {
                task_id: Some("blocker".to_string()),
                state: Some(sacode_kernel::TaskRunState::Completed),
                output_text: Some("done".to_string()),
                ..sacode_kernel::TaskRun::default()
            },
        )
        .await;

    let stats_after = queue.stats().await;
    assert_eq!(stats_after.pending_count, 4);

    let next_ready = queue.next_ready().await;
    assert!(next_ready.is_some());
    assert_eq!(next_ready.unwrap().priority, TaskPriority::Urgent);
}

#[tokio::test]
async fn test_task_queue_stats() {
    let queue = Arc::new(TaskQueue::new(5));

    let stats_before = queue.stats().await;
    assert_eq!(stats_before.ready_count, 0);

    for i in 0..3 {
        let task = ScheduledTask::new(
            format!("task-{}", i),
            Task::new("test", ExecutionMode::Build, None),
        );
        queue.submit(task).await.expect("submit task");
    }

    let stats_after = queue.stats().await;
    assert_eq!(stats_after.ready_count, 3);
}

#[tokio::test]
async fn test_task_queue_respects_concurrency_limit_until_completion() {
    let queue = Arc::new(TaskQueue::new(1));

    queue
        .submit(ScheduledTask::new(
            "concurrency-1".to_string(),
            Task::new("first", ExecutionMode::Build, None),
        ))
        .await
        .expect("submit first");
    queue
        .submit(ScheduledTask::new(
            "concurrency-2".to_string(),
            Task::new("second", ExecutionMode::Build, None),
        ))
        .await
        .expect("submit second");

    let first = queue.next_ready().await.expect("first ready task");
    assert_eq!(first.id, "concurrency-1");

    let blocked = queue.next_ready().await;
    assert!(blocked.is_none());

    queue
        .mark_completed(
            "concurrency-1",
            sacode_kernel::TaskResult::success("concurrency-1".to_string(), "done".to_string(), 1),
            sacode_kernel::TaskRun {
                task_id: Some("concurrency-1".to_string()),
                state: Some(sacode_kernel::TaskRunState::Completed),
                output_text: Some("done".to_string()),
                ..sacode_kernel::TaskRun::default()
            },
        )
        .await;

    let second = queue.next_ready().await.expect("second ready task");
    assert_eq!(second.id, "concurrency-2");
}

#[tokio::test]
async fn test_task_queue_preserves_task_run_for_completed_result() {
    let queue = Arc::new(TaskQueue::new(1));
    queue
        .submit(ScheduledTask::new(
            "queue-run-1".to_string(),
            Task::new("queue run test", ExecutionMode::Build, None),
        ))
        .await
        .expect("submit task");

    let _ = queue.next_ready().await.expect("ready task");
    queue.mark_running("queue-run-1").await;

    queue
        .mark_completed(
            "queue-run-1",
            sacode_kernel::TaskResult::success("queue-run-1".to_string(), "done".to_string(), 1),
            sacode_kernel::TaskRun {
                task_id: Some("queue-run-1".to_string()),
                state: Some(sacode_kernel::TaskRunState::Completed),
                output_text: Some("done".to_string()),
                ..sacode_kernel::TaskRun::default()
            },
        )
        .await;

    let task_run = queue.get_task_run("queue-run-1").await.expect("task run");
    assert_eq!(task_run.state, Some(sacode_kernel::TaskRunState::Completed));
    assert_eq!(task_run.output_text.as_deref(), Some("done"));
}

#[tokio::test]
async fn test_task_queue_cancel() {
    let queue = Arc::new(TaskQueue::new(1));

    let task = ScheduledTask::new(
        "cancel-1".to_string(),
        Task::new("cancel test", ExecutionMode::Build, None),
    );
    let task_id = queue.submit(task).await.expect("submit task");

    let cancelled = queue.cancel(&task_id).await;
    assert!(cancelled);

    let status = queue.status(&task_id).await;
    assert_eq!(status, Some(TaskQueueStatus::Cancelled));
}

#[tokio::test]
async fn test_task_queue_dependency() {
    let queue = Arc::new(TaskQueue::new(2));

    let parent_task = ScheduledTask::new(
        "parent-1".to_string(),
        Task::new("parent", ExecutionMode::Build, None),
    );
    let parent_id = queue.submit(parent_task).await.expect("submit parent");

    let child_task = ScheduledTask::new(
        "child-1".to_string(),
        Task::new("child", ExecutionMode::Build, None),
    )
    .with_dependencies(vec![parent_id.clone()]);
    let child_id = queue.submit(child_task).await.expect("submit child");

    let child_status = queue.status(&child_id).await;
    assert_eq!(child_status, Some(TaskQueueStatus::Pending));

    let completed_ids = queue.get_completed_ids().await;
    assert!(!completed_ids.contains(&child_id));
}

#[tokio::test]
async fn test_retry_policy() {
    let policy = RetryPolicy::exponential(1000, 10000, 3);

    assert_eq!(policy.max_attempts, 3);
    assert_eq!(policy.compute_delay_ms(0), 1000);
    assert_eq!(policy.compute_delay_ms(1), 2000);
    assert_eq!(policy.compute_delay_ms(2), 4000);
    assert_eq!(policy.compute_delay_ms(10), 10000);
}

#[tokio::test]
async fn test_scheduled_task_retry_logic() {
    let mut task = ScheduledTask::new(
        "retry-1".to_string(),
        Task::new("retry test", ExecutionMode::Build, None),
    )
    .with_retry_policy(RetryPolicy::fixed(100, 2));

    assert_eq!(task.current_attempt, 0);
    assert!(task.can_retry());

    task.increment_attempt();
    assert_eq!(task.current_attempt, 1);
    assert!(task.can_retry());

    task.increment_attempt();
    assert_eq!(task.current_attempt, 2);
    assert!(!task.can_retry());
}

#[tokio::test]
async fn test_in_memory_store() {
    let store = Arc::new(InMemoryStore::new());

    let task = ScheduledTask::new(
        "store-1".to_string(),
        Task::new("store test", ExecutionMode::Build, None),
    );

    store.save(&task).await.expect("save task");

    let loaded = store.load("store-1").await.expect("load task");
    assert!(loaded.is_some());
    assert_eq!(loaded.unwrap().id, "store-1");

    let pending = store.load_pending().await.expect("load pending");
    assert_eq!(pending.len(), 1);
}

#[tokio::test]
async fn test_in_memory_store_update_status_filters_pending() {
    let store = Arc::new(InMemoryStore::new());

    let task = ScheduledTask::new(
        "store-status-1".to_string(),
        Task::new("store status test", ExecutionMode::Build, None),
    );

    store.save(&task).await.expect("save task");
    store
        .update_status(&task.id, TaskQueueStatus::Completed)
        .await
        .expect("update status");

    let pending = store.load_pending().await.expect("load pending");
    assert!(pending.is_empty());
}

#[tokio::test]
async fn test_store_db_persists_task_and_result() {
    let tempdir = tempfile::tempdir().expect("tempdir");
    let db_path = tempdir.path().join("task-store.sqlite3");
    let store = StoreDb::new(&db_path).expect("create store db");

    let task = ScheduledTask::new(
        "sqlite-1".to_string(),
        Task::new("persist test", ExecutionMode::Build, None),
    );

    store.save(&task).await.expect("save task");
    store
        .update_status(&task.id, TaskQueueStatus::Running)
        .await
        .expect("update running status");

    let loaded = store.load(&task.id).await.expect("load task");
    assert!(loaded.is_some());
    assert_eq!(loaded.expect("task").id, task.id);

    let pending = store.load_pending().await.expect("load pending");
    assert_eq!(pending.len(), 1);

    let result = sacode_kernel::TaskResult::success(task.id.clone(), "done".to_string(), 42);
    store.save_result(&result).await.expect("save result");

    let pending_after_complete = store
        .load_pending()
        .await
        .expect("load pending after complete");
    assert!(pending_after_complete.is_empty());

    let loaded_result = store.load_result(&task.id).await.expect("load result");
    assert_eq!(
        loaded_result.and_then(|value| value.output),
        Some("done".to_string())
    );
}

#[tokio::test]
async fn test_task_queue_restore_pending_tasks_from_store() {
    let tempdir = tempfile::tempdir().expect("tempdir");
    let db_path = tempdir.path().join("task-store.sqlite3");
    let store = Arc::new(StoreDb::new(&db_path).expect("create store db"));

    let ready_task = ScheduledTask::new(
        "restore-ready".to_string(),
        Task::new("ready task", ExecutionMode::Build, None),
    );
    let pending_task = ScheduledTask::new(
        "restore-pending".to_string(),
        Task::new("pending task", ExecutionMode::Build, None),
    )
    .with_dependencies(vec!["dep-1".to_string()]);

    store.save(&ready_task).await.expect("save ready task");
    store.save(&pending_task).await.expect("save pending task");
    store
        .update_status(&ready_task.id, TaskQueueStatus::Running)
        .await
        .expect("mark running before restore");

    let queue = TaskQueue::new(2).with_store(store);
    let restored = queue
        .restore_pending_tasks()
        .await
        .expect("restore pending tasks");

    assert_eq!(restored, 2);
    assert_eq!(queue.get_ready_count().await, 1);
    assert_eq!(
        queue.status(&pending_task.id).await,
        Some(TaskQueueStatus::Pending)
    );
    assert_eq!(
        queue.status(&ready_task.id).await,
        Some(TaskQueueStatus::Ready)
    );
}

#[tokio::test]
async fn test_daemon_queue_status_endpoint() {
    let app = create_daemon().await;

    let response = app
        .oneshot(
            Request::builder()
                .uri("/queue/status")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("daemon should respond");

    assert_eq!(response.status(), StatusCode::OK);

    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read body");
    let payload: serde_json::Value = serde_json::from_slice(&body).expect("valid json");

    assert!(payload["pending_count"].is_number());
    assert!(payload["running_count"].is_number());
}

#[tokio::test]
async fn test_daemon_restores_pending_tasks_from_store() {
    let lock = sandbox_test_lock();
    drop(lock);
    let tempdir = tempfile::tempdir().expect("tempdir");
    let _dir_guard = CurrentDirGuard::enter(tempdir.path());
    let _home_guard = HomeEnvGuard::set(tempdir.path());

    let store = StoreDb::from_workspace(tempdir.path()).expect("create workspace store");
    let task = ScheduledTask::new(
        "restored-daemon-task".to_string(),
        Task::new("restored prompt", ExecutionMode::Build, None),
    );
    store.save(&task).await.expect("save task");
    store
        .update_status(&task.id, TaskQueueStatus::Running)
        .await
        .expect("mark task running");

    let app = create_daemon().await;

    let response = app
        .oneshot(
            Request::builder()
                .uri(format!("/task/{}/status", task.id))
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("daemon should return restored task status");

    assert_eq!(response.status(), StatusCode::OK);

    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read body");
    let payload: serde_json::Value = serde_json::from_slice(&body).expect("valid json");

    assert_eq!(payload["task_id"], task.id);
    assert_eq!(payload["status"], "ready");
    assert_eq!(payload["queue_status"], "ready");
    assert_eq!(payload["current_event"], "task_restored");
}

#[tokio::test]
async fn test_task_queue_restore_results_from_store() {
    let tempdir = tempfile::tempdir().expect("tempdir");
    let db_path = tempdir.path().join("task-store.sqlite3");
    let store = Arc::new(StoreDb::new(&db_path).expect("create store db"));

    let success_task = ScheduledTask::new(
        "restore-result-success".to_string(),
        Task::new("success restore test", ExecutionMode::Build, None),
    );
    store.save(&success_task).await.expect("save success task");
    let success_result = sacode_kernel::TaskResult::success(
        success_task.id.clone(),
        "done output".to_string(),
        123,
    );
    store
        .save_result(&success_result)
        .await
        .expect("save success result");

    let failed_task = ScheduledTask::new(
        "restore-result-failed".to_string(),
        Task::new("failed restore test", ExecutionMode::Plan, None),
    );
    store.save(&failed_task).await.expect("save failed task");
    let failure_result = sacode_kernel::TaskResult::failure(
        failed_task.id.clone(),
        "boom error".to_string(),
        45,
    );
    store
        .save_result(&failure_result)
        .await
        .expect("save failure result");

    // 新 TaskQueue 实例模拟 daemon 重启：内存 HashMap 为空
    let queue = TaskQueue::new(2).with_store(store);
    let restored = queue.restore_results().await.expect("restore results");
    assert_eq!(restored.len(), 2);

    // completed/failed HashMap 应被恢复填充
    let loaded_success = queue
        .get_result(&success_task.id)
        .await
        .expect("success result should be restored");
    assert_eq!(loaded_success.status, TaskQueueStatus::Completed);
    assert_eq!(loaded_success.output, Some("done output".to_string()));
    assert_eq!(loaded_success.duration_ms, 123);

    let loaded_failure = queue
        .get_result(&failed_task.id)
        .await
        .expect("failure result should be restored");
    assert_eq!(loaded_failure.status, TaskQueueStatus::Failed);
    assert_eq!(loaded_failure.error, Some("boom error".to_string()));
}

#[tokio::test]
async fn test_daemon_restores_completed_results_from_store() {
    let lock = sandbox_test_lock();
    drop(lock);
    let tempdir = tempfile::tempdir().expect("tempdir");
    let _dir_guard = CurrentDirGuard::enter(tempdir.path());
    let _home_guard = HomeEnvGuard::set(tempdir.path());

    let store = StoreDb::from_workspace(tempdir.path()).expect("create workspace store");
    let task = ScheduledTask::new(
        "restored-daemon-result".to_string(),
        Task::new("historical prompt", ExecutionMode::Build, None),
    );
    store.save(&task).await.expect("save task");
    let result = sacode_kernel::TaskResult::success(
        task.id.clone(),
        "historical output".to_string(),
        999,
    );
    store.save_result(&result).await.expect("save result");

    let app = create_daemon().await;

    // /task/:id/result 应返回历史结果而非 not_found
    let result_response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/task/{}/result", task.id))
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("daemon should return result");
    assert_eq!(result_response.status(), StatusCode::OK);

    let result_body = to_bytes(result_response.into_body(), usize::MAX)
        .await
        .expect("read body");
    let result_payload: serde_json::Value =
        serde_json::from_slice(&result_body).expect("valid json");
    assert_eq!(result_payload["task_id"], task.id);
    assert_eq!(result_payload["status"], "completed");
    assert_eq!(result_payload["output"], "historical output");
    assert_eq!(result_payload["duration_ms"], 999);

    // /task/:id/status 应返回完整信息（含 prompt/mode/priority）
    let status_response = app
        .oneshot(
            Request::builder()
                .uri(format!("/task/{}/status", task.id))
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("daemon should return status");
    assert_eq!(status_response.status(), StatusCode::OK);

    let status_body = to_bytes(status_response.into_body(), usize::MAX)
        .await
        .expect("read body");
    let status_payload: serde_json::Value =
        serde_json::from_slice(&status_body).expect("valid json");
    assert_eq!(status_payload["task_id"], task.id);
    assert_eq!(status_payload["prompt"], "historical prompt");
    assert_eq!(status_payload["status"], "completed");
    assert_eq!(status_payload["queue_status"], "completed");
    assert_eq!(status_payload["current_event"], "task_restored");
    assert_eq!(status_payload["output"], "historical output");
}

#[tokio::test]
async fn test_daemon_task_with_priority() {
    let app = create_daemon().await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/task")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"prompt":"test","mode":"build","priority":"high"}"#,
                ))
                .expect("build request"),
        )
        .await
        .expect("daemon should create task");

    assert_eq!(response.status(), StatusCode::OK);

    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read body");
    let payload: serde_json::Value = serde_json::from_slice(&body).expect("valid json");

    assert_eq!(payload["status"], "queued");
}

#[tokio::test]
async fn test_daemon_task_cancel_endpoint() {
    let app = create_daemon().await;

    let create_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/task")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"prompt":"test","mode":"build"}"#))
                .expect("build request"),
        )
        .await
        .expect("daemon should create task");

    let body = to_bytes(create_response.into_body(), usize::MAX)
        .await
        .expect("read body");
    let payload: serde_json::Value = serde_json::from_slice(&body).expect("valid json");
    let task_id = payload["task_id"].as_str().expect("task id");

    tokio::time::sleep(Duration::from_millis(10)).await;

    let cancel_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/task/{}/cancel", task_id))
                .body(Body::empty())
                .expect("build request"),
        )
        .await;

    let resp = cancel_response.expect("cancel response");
    assert_eq!(resp.status(), StatusCode::OK);

    let status_response = app
        .oneshot(
            Request::builder()
                .uri(format!("/task/{}/status", task_id))
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("status response");

    let status_body = to_bytes(status_response.into_body(), usize::MAX)
        .await
        .expect("read status body");
    let status_payload: serde_json::Value =
        serde_json::from_slice(&status_body).expect("valid status json");

    assert_eq!(status_payload["status"], "failed");
    assert_eq!(status_payload["queue_status"], "failed");
    assert_eq!(status_payload["task_run"]["state"].as_str(), Some("Failed"));
    assert_eq!(
        status_payload["task_run"]["output_text"].as_str(),
        Some("Task cancelled")
    );
}

#[tokio::test]
async fn test_daemon_task_with_retry_policy() {
    let app = create_daemon().await;

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/task")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"prompt":"test","mode":"build","retry_policy":{"max_attempts":3,"backoff_type":"exponential","base_ms":1000,"max_ms":10000}}"#))
                .expect("build request"),
        )
        .await
        .expect("daemon should create task");

    assert_eq!(response.status(), StatusCode::OK);

    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read body");
    let payload: serde_json::Value = serde_json::from_slice(&body).expect("valid json");

    assert_eq!(payload["status"], "queued");
}
