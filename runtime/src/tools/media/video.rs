use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};

use crate::sandbox::FsAccess;
use crate::tools::{SideEffectLevel, ToolOutput, ToolSpec};

use crate::tools::context::current_context;
use crate::tools::media::vision::try_visual_read;

pub fn spec() -> ToolSpec {
    ToolSpec {
        name: "media.video".to_string(),
        description: "提取视频关键帧并逐帧理解，按时间线聚合描述".to_string(),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "视频文件路径" },
                "mode": { "type": "string", "enum": ["describe", "ocr"], "default": "describe" },
                "frames": { "type": "integer", "description": "均匀采样帧数（默认 5）", "default": 5 },
                "prompt": { "type": "string", "description": "可选，自定义每帧视觉提示词" },
                "model": { "type": "string", "description": "可选，显式指定视觉模型" },
                "base_url": { "type": "string", "description": "可选，显式指定 provider base url" },
                "api_key": { "type": "string", "description": "可选，显式指定 provider api key" }
            },
            "required": ["path"]
        }),
        output_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "path": { "type": "string" },
                "mime_type": { "type": "string" },
                "frames": { "type": "integer" },
                "frames_extracted": { "type": "integer" },
                "ffmpeg_available": { "type": "boolean" },
                "timeline": { "type": "array", "items": { "type": "string" } },
                "summary": { "type": "string" }
            }
        }),
        side_effect_level: SideEffectLevel::ReadOnly,
        approval_required: false,
        timeout_ms: Some(60_000),
        tags: vec!["media".to_string(), "video".to_string()],
    }
}

pub fn execute(input: serde_json::Value) -> anyhow::Result<ToolOutput> {
    let path = input["path"].as_str().unwrap_or("");
    let mode = input["mode"].as_str().unwrap_or("describe");
    if path.is_empty() {
        return Ok(ToolOutput::failure("path is required"));
    }
    if !matches!(mode, "ocr" | "describe") {
        return Ok(ToolOutput::failure("mode must be one of: ocr, describe"));
    }
    let frames = input["frames"].as_u64().unwrap_or(5).clamp(1, 20) as usize;

    let file_path = current_context().resolve_path(path, FsAccess::Read)?;
    if !file_path.exists() {
        return Ok(ToolOutput::failure(format!("file not found: {}", path)));
    }
    let mime_type = detect_video_mime(path);

    // 灵枢 · 多模态（M4）：ffmpeg 不可用时优雅降级为仅提取元信息
    let ffmpeg_available = is_ffmpeg_available();
    if !ffmpeg_available {
        return Ok(ToolOutput::success(serde_json::json!({
            "path": file_path.display().to_string(),
            "mime_type": mime_type,
            "frames": frames,
            "frames_extracted": 0,
            "ffmpeg_available": false,
            "timeline": [],
            "summary": format!(
                "视频理解依赖 ffmpeg 提取帧，但当前环境未检测到 ffmpeg。文件: {}，类型: {}。",
                file_path.display(),
                mime_type
            )
        })));
    }

    let work_dir = std::env::temp_dir().join(format!(
        "sacode_video_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    fs::create_dir_all(&work_dir)?;

    let extracted = match extract_frames(&file_path, &work_dir, frames) {
        Ok(paths) => paths,
        Err(err) => {
            fs::remove_dir_all(&work_dir).ok();
            return Ok(ToolOutput::success(serde_json::json!({
                "path": file_path.display().to_string(),
                "mime_type": mime_type,
                "frames": frames,
                "frames_extracted": 0,
                "ffmpeg_available": true,
                "timeline": [],
                "summary": format!("视频帧提取失败: {}", err)
            })));
        }
    };

    let prompt = input
        .get("prompt")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| build_frame_prompt(mode, &file_path.display().to_string()));

    // 帧级超时：将工具总超时按帧数平摊，避免多帧时最坏累计远超 ToolSpec.timeout_ms
    // （例如 frames=5、timeout=60s 时，若每帧各用 60s，最坏累计 300s）。
    let per_frame_timeout = {
        let total = spec().timeout_ms.unwrap_or(60_000);
        let frames = frames.max(1) as u64;
        Duration::from_millis(total / frames)
    };
    let mut timeline = Vec::new();
    for (idx, frame) in extracted.iter().enumerate() {
        let bytes = match fs::read(frame) {
            Ok(b) => b,
            Err(_) => continue,
        };
        let frame_input = serde_json::json!({
            "model": input.get("model").cloned().unwrap_or(serde_json::Value::Null),
            "base_url": input.get("base_url").cloned().unwrap_or(serde_json::Value::Null),
            "api_key": input.get("api_key").cloned().unwrap_or(serde_json::Value::Null),
        });
        match try_visual_read(
            &frame_input,
            frame,
            &bytes,
            "image/png",
            &format!("第 {} 帧。{}", idx + 1, prompt),
            per_frame_timeout,
        ) {
            Ok((text, _)) => timeline.push(format!("[帧 {}] {}", idx + 1, text)),
            Err(_) => timeline.push(format!("[帧 {}] （视觉理解失败，跳过）", idx + 1)),
        }
    }

    fs::remove_dir_all(&work_dir).ok();

    let summary = if timeline.is_empty() {
        format!(
            "未能从视频提取可理解的帧。文件: {}，类型: {}。",
            file_path.display(),
            mime_type
        )
    } else {
        timeline.join("\n")
    };

    Ok(ToolOutput::success(serde_json::json!({
        "path": file_path.display().to_string(),
        "mime_type": mime_type,
        "frames": frames,
        "frames_extracted": timeline.len(),
        "ffmpeg_available": true,
        "timeline": timeline,
        "summary": summary
    })))
}

/// 均匀采样提取视频关键帧为 PNG 图片
fn extract_frames(video: &Path, work_dir: &Path, frames: usize) -> anyhow::Result<Vec<PathBuf>> {
    // 先探测视频时长（秒）
    let duration = probe_duration(video)?;
    let count = frames.max(1);
    let mut outputs = Vec::new();

    if duration <= 0.0 {
        // 无法探测时长：仅提取首帧
        let out = work_dir.join("frame_001.png");
        extract_single_frame(video, &out, 0.0)?;
        outputs.push(out);
        return Ok(outputs);
    }

    for i in 0..count {
        // 在时间轴上均匀采样（含起点附近，避开最末帧）
        let ts = if count == 1 {
            0.0
        } else {
            (i as f64) * duration / (count as f64 - 1.0)
        };
        let out = work_dir.join(format!("frame_{:03}.png", i + 1));
        extract_single_frame(video, &out, ts)?;
        outputs.push(out);
    }
    Ok(outputs)
}

/// 调用 ffmpeg 在指定时间点提取单帧
fn extract_single_frame(video: &Path, out: &Path, ts: f64) -> anyhow::Result<()> {
    let status = Command::new("ffmpeg")
        .args([
            "-y",
            "-ss",
            &format!("{:.3}", ts),
            "-i",
            &video.to_string_lossy(),
            "-frames:v",
            "1",
            "-q:v",
            "2",
            &out.to_string_lossy(),
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()?;
    if !status.success() {
        anyhow::bail!("ffmpeg 退出码非零: {:?}", status.code());
    }
    if !out.exists() {
        anyhow::bail!("ffmpeg 未生成帧文件: {}", out.display());
    }
    Ok(())
}

/// 探测视频时长（秒），失败返回 0.0
fn probe_duration(video: &Path) -> anyhow::Result<f64> {
    let output = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            &video.to_string_lossy(),
        ])
        .output()?;
    if !output.status.success() {
        return Ok(0.0);
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let duration = text
        .trim()
        .parse::<f64>()
        .map(|v| if v.is_finite() && v > 0.0 { v } else { 0.0 })
        .unwrap_or(0.0);
    Ok(duration)
}

/// 检测 ffmpeg 是否可用
fn is_ffmpeg_available() -> bool {
    Command::new("ffmpeg")
        .arg("-version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn detect_video_mime(path: &str) -> &'static str {
    match path
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_lowercase()
        .as_str()
    {
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "mkv" => "video/x-matroska",
        "avi" => "video/x-msvideo",
        _ => "application/octet-stream",
    }
}

fn build_frame_prompt(mode: &str, path: &str) -> String {
    match mode {
        "ocr" => format!("请对这帧视频画面执行 OCR，提取可见文字。文件路径: {}", path),
        _ => format!(
            "请描述这帧视频画面的主要内容、主体与关键视觉信息。文件路径: {}",
            path
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spec_declares_video_tool_and_timeout() {
        let s = spec();
        assert_eq!(s.name, "media.video");
        assert!(s.timeout_ms.is_some());
        assert_eq!(s.side_effect_level, SideEffectLevel::ReadOnly);
    }

    #[test]
    fn detect_video_mime_maps_known_extensions() {
        assert_eq!(detect_video_mime("clip.mp4"), "video/mp4");
        assert_eq!(detect_video_mime("clip.webm"), "video/webm");
        assert_eq!(detect_video_mime("clip.mov"), "video/quicktime");
        assert_eq!(
            detect_video_mime("clip.unknown"),
            "application/octet-stream"
        );
    }

    #[test]
    fn execute_reports_missing_file_as_failure() {
        // 相对 cwd 的不存在路径（sandbox 允许），应返回 failure 输出
        let name = format!("sacode_video_nonexistent_{}.mp4", std::process::id());
        let out = execute(serde_json::json!({ "path": name.clone() }));
        match out {
            Ok(tool_out) => assert!(!tool_out.success),
            Err(_) => {} // sandbox 拦截属可接受路径
        }
    }

    #[test]
    fn execute_degrades_gracefully_without_ffmpeg() {
        let name = format!("sacode_video_test_{}.mp4", std::process::id());
        let _ = fs::write(&name, b"not-a-real-video");
        let out = execute(serde_json::json!({ "path": name.clone() }));
        let _ = fs::remove_file(&name);
        let out = match out {
            Ok(tool_out) => tool_out,
            Err(_) => return, // sandbox 拦截时不强制校验字段
        };
        assert!(out.data.get("ffmpeg_available").is_some());
        assert!(out.data.get("timeline").is_some());
        if !out.data["ffmpeg_available"].as_bool().unwrap_or(false) {
            assert_eq!(out.data["frames_extracted"].as_u64(), Some(0));
        }
    }
}
