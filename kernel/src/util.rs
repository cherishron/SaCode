//! 通用工具函数（无外部依赖）

/// 按最大字节数截断字符串，并保证不落在 UTF-8 多字节字符中间。
///
/// 返回 `(截断后的字符串, 是否发生了截断)`。
/// 若 `max_bytes` 落在字符中间，会向前回退到最近的字符边界。
pub fn truncate_utf8(s: &str, max_bytes: usize) -> (String, bool) {
    if s.len() <= max_bytes {
        return (s.to_string(), false);
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    (s[..end].to_string(), true)
}

/// 截断字符串并追加省略号（保持字符边界安全）。
pub fn truncate_with_ellipsis(s: &str, max_bytes: usize) -> String {
    let (truncated, did_truncate) = truncate_utf8(s, max_bytes);
    if did_truncate {
        format!("{}...", truncated)
    } else {
        truncated
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncate_short_string_unchanged() {
        assert_eq!(truncate_utf8("hello", 10), ("hello".to_string(), false));
    }

    #[test]
    fn truncate_ascii_long() {
        let (s, did) = truncate_utf8("hello world", 5);
        assert_eq!(s, "hello");
        assert!(did);
    }

    #[test]
    fn truncate_multi_byte_no_panic() {
        let text = "中文内容测试";
        let (s, did) = truncate_utf8(text, 5);
        assert!(did);
        // 回退到字符边界，s 必须是合法 UTF-8 前缀
        assert!(text.starts_with(&s));
    }

    #[test]
    fn truncate_ellipsis() {
        assert_eq!(truncate_with_ellipsis("hello", 3), "hel...");
        assert_eq!(truncate_with_ellipsis("hello", 10), "hello");
    }
}
