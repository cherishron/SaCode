use anyhow::{bail, Context, Result};
use base64::Engine;
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeSet, HashMap},
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};

use sacode_runtime::code_audit::{is_supported_code_path, AuditReport, Finding};

const GITHUB_API: &str = "https://api.github.com";
const USER_AGENT: &str = "sacode-audit-pr";
const PAGE_SIZE: usize = 100;
const MAX_DISCOVERY_PAGES: usize = 10;
const MAX_REVIEW_PAGES: usize = 3;
const MAX_INLINE_COMMENTS: usize = 50;
const MAX_BLOB_BYTES: usize = 1_048_576;
const REVIEW_MARKER: &str = "<!-- sacode-audit-pr -->";
const INCREMENT_MARKER: &str = "<!-- sacode-audit-pr-increment -->";
const INLINE_MARKER_PREFIX: &str = "<!-- sacode:";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GitHubRepo {
    pub owner: String,
    pub name: String,
}

impl GitHubRepo {
    pub fn parse(value: &str) -> Result<Self> {
        let value = value.trim().trim_end_matches(".git");
        let parts = value.split('/').collect::<Vec<_>>();
        if parts.len() != 2 || !valid_segment(parts[0]) || !valid_segment(parts[1]) {
            bail!("GitHub 仓库格式必须是 owner/name");
        }
        Ok(Self {
            owner: parts[0].to_string(),
            name: parts[1].to_string(),
        })
    }

    pub fn slug(&self) -> String {
        format!("{}/{}", self.owner, self.name)
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PullRequestInfo {
    pub number: u64,
    pub title: String,
    pub html_url: String,
    pub state: String,
    pub draft: bool,
    pub head: PullRequestRef,
    pub base: PullRequestRef,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PullRequestRef {
    pub sha: String,
    #[serde(rename = "ref")]
    pub ref_name: String,
    #[serde(default)]
    pub repo: Option<PullRequestRepo>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PullRequestRepo {
    pub full_name: String,
}

#[derive(Debug, Clone, Deserialize)]
struct PullRequestFile {
    filename: String,
    status: String,
    sha: String,
    patch: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GitBlob {
    content: String,
    encoding: String,
    size: usize,
}

#[derive(Debug)]
pub struct PullRequestDiff {
    pub pr: PullRequestInfo,
    pub contents: HashMap<String, String>,
    pub changed_lines: HashMap<String, BTreeSet<u32>>,
    pub skipped_files: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct PublishedReview {
    pub review_id: u64,
    pub html_url: Option<String>,
    pub comments: usize,
    pub posted_review: Option<u64>,
    pub existing_review_id: Option<u64>,
    pub skipped_existing_comments: usize,
}

#[derive(Debug, Deserialize)]
struct ReviewResponse {
    id: u64,
    html_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ReviewListEntry {
    id: u64,
    body: Option<String>,
    html_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ReviewCommentEntry {
    body: Option<String>,
}

#[derive(Clone)]
pub struct GitHubPrClient {
    http: Client,
    token: String,
    api_base: String,
}

impl GitHubPrClient {
    pub fn new(token: String) -> Result<Self> {
        let http = Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .context("创建 GitHub HTTP client 失败")?;
        Ok(Self {
            http,
            token,
            api_base: GITHUB_API.to_string(),
        })
    }

    #[cfg(test)]
    fn with_api_base(token: String, api_base: String) -> Result<Self> {
        let mut client = Self::new(token)?;
        client.api_base = api_base;
        Ok(client)
    }

    pub async fn resolve_pr(
        &self,
        repo: &GitHubRepo,
        number: Option<u64>,
        current_branch: &str,
    ) -> Result<PullRequestInfo> {
        if let Some(number) = number {
            if number == 0 {
                bail!("PR 编号必须大于 0");
            }
            return self
                .get_json(&format!(
                    "/repos/{}/{}/pulls/{number}",
                    repo.owner, repo.name
                ))
                .await;
        }
        if current_branch.trim().is_empty() || current_branch == "HEAD" {
            bail!("当前处于 detached HEAD，请显式提供 PR 编号");
        }
        let mut matches = Vec::new();
        for page in 1..=MAX_DISCOVERY_PAGES {
            let path = format!(
                "/repos/{}/{}/pulls?state=open&per_page={PAGE_SIZE}&page={page}",
                repo.owner, repo.name
            );
            let prs: Vec<PullRequestInfo> = self.get_json(&path).await?;
            let count = prs.len();
            matches.extend(
                prs.into_iter()
                    .filter(|pr| pr.head.ref_name == current_branch),
            );
            if count < PAGE_SIZE {
                break;
            }
        }
        select_pr(matches, &repo.slug(), current_branch)
    }

    pub async fn fetch_diff(
        &self,
        repo: &GitHubRepo,
        pr: PullRequestInfo,
        max_files: usize,
    ) -> Result<PullRequestDiff> {
        let mut selected = Vec::new();
        let mut skipped_files = 0;
        for page in 1..=MAX_DISCOVERY_PAGES {
            if selected.len() >= max_files {
                break;
            }
            let path = format!(
                "/repos/{}/{}/pulls/{}/files?per_page={PAGE_SIZE}&page={page}",
                repo.owner, repo.name, pr.number
            );
            let files: Vec<PullRequestFile> = self.get_json(&path).await?;
            let count = files.len();
            for file in files {
                if selected.len() >= max_files {
                    skipped_files += 1;
                    continue;
                }
                if file.status == "removed"
                    || !is_supported_code_path(Path::new(&file.filename))
                    || file.patch.is_none()
                {
                    skipped_files += 1;
                    continue;
                }
                let lines = parse_patch_added_lines(file.patch.as_deref().unwrap_or_default());
                if lines.is_empty() {
                    skipped_files += 1;
                    continue;
                }
                selected.push((file, lines));
            }
            if count < PAGE_SIZE {
                break;
            }
        }

        let mut contents = HashMap::new();
        let mut changed_lines = HashMap::new();
        for chunk in selected.chunks(8) {
            let mut jobs = tokio::task::JoinSet::new();
            for (file, lines) in chunk.iter().cloned() {
                let client = self.clone();
                let repo = repo.clone();
                jobs.spawn(async move {
                    let content = client.fetch_blob(&repo, &file.sha).await?;
                    Ok::<_, anyhow::Error>((file, lines, content))
                });
            }
            while let Some(result) = jobs.join_next().await {
                let (file, lines, content) = result.context("GitHub blob 下载任务失败")??;
                match content {
                    Some(content) => {
                        changed_lines.insert(file.filename.clone(), lines);
                        contents.insert(file.filename, content);
                    }
                    None => skipped_files += 1,
                }
            }
        }

        Ok(PullRequestDiff {
            pr,
            contents,
            changed_lines,
            skipped_files,
        })
    }

    /// Publish the SaCode review on a PR, idempotently.
    ///
    /// A summary review is posted only when the PR has no existing SaCode
    /// summary review: re-running without new findings posts nothing. Inline
    /// comments are keyed by `path:line`, and findings that already have an
    /// inline comment are skipped.
    ///
    /// GitHub does not allow deleting a submitted review, and the summary of a
    /// `COMMENT` review is not PATCH-able (`PATCH` is only accepted on reviews
    /// in `APPROVED` or `DISMISSED` state), so there is no way to refresh an
    /// existing summary review in place; repeated runs therefore add at most
    /// one increment review per set of new findings and never duplicate the
    /// summary.
    pub async fn publish_review(
        &self,
        repo: &GitHubRepo,
        pr: &PullRequestInfo,
        report: &AuditReport,
        changed_lines: &HashMap<String, BTreeSet<u32>>,
    ) -> Result<PublishedReview> {
        let reviews = self.list_reviews(repo, pr.number).await?;
        let posted = existing_comment_keys(
            self.list_review_comments(repo, pr.number)
                .await?
                .iter()
                .filter_map(|comment| comment.body.as_deref()),
        );
        let (comments, skipped_existing_comments) =
            build_inline_comments(&report.findings, changed_lines, &posted);
        let review_count = comments.len();

        let Some(canonical) = find_canonical_review(&reviews) else {
            let payload = build_review_payload(pr, &review_summary(report), &comments);
            let response: ReviewResponse = self
                .post_json(&reviews_path(repo, pr.number), &payload)
                .await?;
            return Ok(PublishedReview {
                review_id: response.id,
                html_url: response.html_url.clone(),
                comments: review_count,
                posted_review: Some(response.id),
                existing_review_id: None,
                skipped_existing_comments,
            });
        };

        if comments.is_empty() {
            return Ok(PublishedReview {
                review_id: canonical.id,
                html_url: canonical.html_url.clone(),
                comments: 0,
                posted_review: None,
                existing_review_id: Some(canonical.id),
                skipped_existing_comments,
            });
        }

        let payload = build_review_payload(pr, &increment_summary(review_count), &comments);
        let response: ReviewResponse = self
            .post_json(&reviews_path(repo, pr.number), &payload)
            .await?;
        Ok(PublishedReview {
            review_id: canonical.id,
            html_url: canonical.html_url.clone(),
            comments: review_count,
            posted_review: Some(response.id),
            existing_review_id: Some(canonical.id),
            skipped_existing_comments,
        })
    }

    async fn list_reviews(&self, repo: &GitHubRepo, number: u64) -> Result<Vec<ReviewListEntry>> {
        self.list_paged(&reviews_path(repo, number), "reviews")
            .await
    }

    async fn list_review_comments(
        &self,
        repo: &GitHubRepo,
        number: u64,
    ) -> Result<Vec<ReviewCommentEntry>> {
        self.list_paged(
            &format!(
                "/repos/{}/{}/pulls/{number}/comments",
                repo.owner, repo.name
            ),
            "review comments",
        )
        .await
    }

    async fn list_paged<T: for<'de> Deserialize<'de>>(
        &self,
        base: &str,
        label: &str,
    ) -> Result<Vec<T>> {
        let mut all = Vec::new();
        for page in 1..=MAX_REVIEW_PAGES {
            let batch: Vec<T> = self
                .get_json(&format!("{base}?per_page={PAGE_SIZE}&page={page}"))
                .await
                .with_context(|| format!("读取 GitHub {label} 失败"))?;
            let count = batch.len();
            all.extend(batch);
            if count < PAGE_SIZE {
                break;
            }
        }
        Ok(all)
    }

    async fn fetch_blob(&self, repo: &GitHubRepo, sha: &str) -> Result<Option<String>> {
        let blob: GitBlob = self
            .get_json(&format!(
                "/repos/{}/{}/git/blobs/{sha}",
                repo.owner, repo.name
            ))
            .await?;
        if blob.encoding != "base64" || blob.size > MAX_BLOB_BYTES {
            return Ok(None);
        }
        let compact = blob
            .content
            .chars()
            .filter(|c| !c.is_whitespace())
            .collect::<String>();
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(compact)
            .context("解码 GitHub blob 失败")?;
        Ok(String::from_utf8(bytes).ok())
    }

    fn request(&self, method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
        self.http
            .request(method, format!("{}{}", self.api_base, path))
            .bearer_auth(&self.token)
            .header(reqwest::header::USER_AGENT, USER_AGENT)
            .header(reqwest::header::ACCEPT, "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
    }

    async fn get_json<T: for<'de> Deserialize<'de>>(&self, path: &str) -> Result<T> {
        let response = self
            .request(reqwest::Method::GET, path)
            .send()
            .await
            .context("GitHub API 请求失败")?;
        decode_response(response).await
    }

    async fn post_json<T: for<'de> Deserialize<'de>>(
        &self,
        path: &str,
        body: &serde_json::Value,
    ) -> Result<T> {
        let response = self
            .request(reqwest::Method::POST, path)
            .json(body)
            .send()
            .await
            .context("GitHub review 发布失败")?;
        decode_response(response).await
    }
}

/// Pick the single PR whose head branch matches. A same-repo head wins over
/// forks; anything still ambiguous must be disambiguated by an explicit number.
fn select_pr(
    mut matches: Vec<PullRequestInfo>,
    repo_slug: &str,
    current_branch: &str,
) -> Result<PullRequestInfo> {
    let same_repo = matches
        .iter()
        .enumerate()
        .filter(|(_, pr)| {
            pr.head
                .repo
                .as_ref()
                .is_some_and(|head_repo| head_repo.full_name.eq_ignore_ascii_case(repo_slug))
        })
        .map(|(index, _)| index)
        .collect::<Vec<_>>();
    if same_repo.len() == 1 {
        return Ok(matches.remove(same_repo[0]));
    }
    match matches.len() {
        1 => Ok(matches.remove(0)),
        0 => bail!(
            "未找到 head 分支为 `{current_branch}` 的开放 PR，请显式提供编号: sacode audit pr <number>"
        ),
        _ => bail!(
            "当前分支匹配多个开放 PR: {}；请显式提供编号",
            matches
                .iter()
                .map(|pr| format!("#{}", pr.number))
                .collect::<Vec<_>>()
                .join(", ")
        ),
    }
}

async fn decode_response<T: for<'de> Deserialize<'de>>(response: reqwest::Response) -> Result<T> {
    let status = response.status();
    let body = response.text().await.context("读取 GitHub 响应失败")?;
    if !status.is_success() {
        let message = serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|value| {
                value
                    .get("message")
                    .and_then(|v| v.as_str())
                    .map(str::to_string)
            })
            .unwrap_or_else(|| truncate(&body, 300));
        if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
            bail!("GitHub 鉴权失败 ({status}): {message}；请运行 sacode git auth login github");
        }
        bail!("GitHub API 返回 {status}: {message}");
    }
    serde_json::from_str(&body).context("解析 GitHub API 响应失败")
}

pub fn repo_root(start: &Path) -> Result<PathBuf> {
    Ok(PathBuf::from(
        git_text(start, &["rev-parse", "--show-toplevel"])?.trim(),
    ))
}

pub fn current_branch(root: &Path) -> Result<String> {
    Ok(git_text(root, &["branch", "--show-current"])?
        .trim()
        .to_string())
}

pub fn discover_github_repo(root: &Path, override_repo: Option<&str>) -> Result<GitHubRepo> {
    if let Some(value) = override_repo {
        return GitHubRepo::parse(value);
    }
    let remote = git_text(root, &["remote", "get-url", "origin"])?;
    parse_github_remote(remote.trim()).ok_or_else(|| {
        anyhow::anyhow!("origin 不是可识别的 GitHub remote；请使用 --repo owner/name 显式指定")
    })
}

pub fn parse_github_remote(remote: &str) -> Option<GitHubRepo> {
    let remote = remote.trim().trim_end_matches('/');
    let slug = if let Some(rest) = remote.strip_prefix("git@github.com:") {
        rest
    } else if let Some(rest) = remote.strip_prefix("ssh://git@github.com/") {
        rest
    } else if let Some(rest) = remote.strip_prefix("https://github.com/") {
        rest
    } else {
        return None;
    };
    GitHubRepo::parse(slug).ok()
}

pub fn review_summary(report: &AuditReport) -> String {
    let mut body = format!(
        "## SaCode PR Review\n\n- High: {}\n- Medium: {}\n- Low: {}\n- Info: {}\n- AI: {}\n- Reviewed files: {}\n- Added lines: {}\n",
        report.summary.high,
        report.summary.medium,
        report.summary.low,
        report.summary.info,
        if report.ai_used { "yes" } else { "no" },
        report.files_scanned,
        report.changed_lines,
    );
    if report.findings.is_empty() {
        body.push_str("\n未发现明显问题。自动审查范围有限，不等于绝对安全。\n");
    } else {
        body.push_str("\n### Findings\n");
        for finding in report.findings.iter().take(20) {
            body.push_str(&format!(
                "- **{}** `{}` {}:{} — {}\n",
                finding.severity.as_str(),
                sanitize_github_text(&finding.id),
                sanitize_github_text(&finding.file),
                finding.line.unwrap_or(0),
                sanitize_github_text(&finding.title),
            ));
        }
        if report.findings.len() > 20 {
            body.push_str(&format!("- … and {} more\n", report.findings.len() - 20));
        }
    }
    body.push_str(&format!("\n{REVIEW_MARKER}"));
    body
}

/// Body for the extra review that carries inline comments discovered after the
/// canonical review was first published. Deliberately does NOT carry
/// `REVIEW_MARKER`, so it is never mistaken for the canonical review.
fn increment_summary(new_comments: usize) -> String {
    format!(
        "### SaCode PR Review（增量）\n\n本次新增 {new_comments} 条行内评论。\n\n{INCREMENT_MARKER}"
    )
}

fn reviews_path(repo: &GitHubRepo, number: u64) -> String {
    format!("/repos/{}/{}/pulls/{number}/reviews", repo.owner, repo.name)
}

/// The oldest review carrying `REVIEW_MARKER`. Its existence is enough to
/// decide that no further summary review must be posted; review state does not
/// matter because we never attempt to edit a published review.
fn find_canonical_review(reviews: &[ReviewListEntry]) -> Option<&ReviewListEntry> {
    reviews
        .iter()
        .filter(|review| {
            review
                .body
                .as_deref()
                .is_some_and(|body| body.contains(REVIEW_MARKER))
        })
        .min_by_key(|review| review.id)
}

/// Inline comment bodies encode their anchor as `<!-- sacode:<path>:<line> -->`.
/// Requiring the colon keeps the summary marker (`<!-- sacode-audit-pr -->`) out.
fn extract_inline_key(body: &str) -> Option<String> {
    let start = body.find(INLINE_MARKER_PREFIX)? + INLINE_MARKER_PREFIX.len();
    let rest = &body[start..];
    let end = rest.find(" -->")?;
    Some(rest[..end].trim().to_string())
}

fn existing_comment_keys<'a>(bodies: impl Iterator<Item = &'a str>) -> BTreeSet<String> {
    bodies.filter_map(extract_inline_key).collect()
}

/// Dedupe key for an inline comment. `>` and other HTML-comment delimiters are
/// mapped away so a crafted path cannot terminate the marker early.
fn comment_key(path: &str, line: u32) -> String {
    let safe: String = path
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '/' | '.' | '-' | '_') {
                c
            } else {
                '_'
            }
        })
        .collect();
    format!("{safe}:{line}")
}

fn build_review_payload(
    pr: &PullRequestInfo,
    body: &str,
    comments: &[serde_json::Value],
) -> serde_json::Value {
    serde_json::json!({
        "commit_id": pr.head.sha,
        "body": truncate(body, 60_000),
        "event": "COMMENT",
        "comments": comments,
    })
}

/// Inline comments for findings that land on added lines and have not been
/// commented on before. Returns `(comments, count_already_posted)`.
fn build_inline_comments(
    findings: &[Finding],
    changed_lines: &HashMap<String, BTreeSet<u32>>,
    posted: &BTreeSet<String>,
) -> (Vec<serde_json::Value>, usize) {
    let mut comments = Vec::new();
    let mut already_posted = 0;
    for finding in findings {
        let Some(line) = finding.line else {
            continue;
        };
        let path = finding.file.replace('\\', "/");
        if !changed_lines
            .get(&path)
            .is_some_and(|lines| lines.contains(&line))
        {
            continue;
        }
        let key = comment_key(&path, line);
        if posted.contains(&key) {
            already_posted += 1;
            continue;
        }
        if comments.len() >= MAX_INLINE_COMMENTS {
            continue;
        }
        comments.push(serde_json::json!({
            "path": path,
            "line": line,
            "side": "RIGHT",
            "body": truncate(&format!(
                "**{} · {}** — {}\n\n{}\n\n**建议：** {}\n\n{INLINE_MARKER_PREFIX}{key} -->",
                finding.severity.as_str(),
                sanitize_github_text(&finding.id),
                sanitize_github_text(&finding.title),
                sanitize_github_text(&finding.detail),
                sanitize_github_text(&finding.suggestion),
            ), 6000),
        }));
    }
    (comments, already_posted)
}

fn sanitize_github_text(value: &str) -> String {
    value
        .replace('@', "@\u{200b}")
        .replace("<!--", "<\u{200b}!--")
}

fn parse_patch_added_lines(patch: &str) -> BTreeSet<u32> {
    let mut added = BTreeSet::new();
    let mut new_line: Option<u32> = None;
    for line in patch.lines() {
        if line.starts_with("@@") {
            new_line = line
                .split_whitespace()
                .find(|part| part.starts_with('+'))
                .and_then(|range| {
                    range
                        .trim_start_matches('+')
                        .split(',')
                        .next()
                        .and_then(|value| value.parse::<u32>().ok())
                });
            continue;
        }
        let Some(current) = new_line else {
            continue;
        };
        if line.starts_with('+') && !line.starts_with("+++") {
            added.insert(current);
            new_line = Some(current.saturating_add(1));
        } else if line.starts_with('-') || line.starts_with("\\ No newline") {
            continue;
        } else {
            new_line = Some(current.saturating_add(1));
        }
    }
    added
}

fn git_text(root: &Path, args: &[&str]) -> Result<String> {
    let output = Command::new("git")
        .current_dir(root)
        .args(args)
        .output()
        .with_context(|| format!("执行 git {} 失败", args.join(" ")))?;
    if !output.status.success() {
        bail!(
            "git {} 失败: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    String::from_utf8(output.stdout).context("Git 输出不是有效 UTF-8")
}

fn valid_segment(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 100
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

fn truncate(value: &str, max: usize) -> String {
    if value.len() <= max {
        return value.to_string();
    }
    let mut end = max;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &value[..end])
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        sync::mpsc,
        thread,
    };

    /// Serve the GitHub endpoints `audit pr` uses. `existing_review_id` and
    /// `existing_comment_body` seed the PR with a prior SaCode publish so the
    /// re-publish path can be exercised; passing `None` simulates a fresh PR.
    fn spawn_github_mock(
        existing_review_id: Option<u64>,
        existing_comment_body: Option<&str>,
        expected_requests: usize,
    ) -> (String, mpsc::Receiver<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let (tx, rx) = mpsc::channel();
        let existing_comment_body = existing_comment_body.map(str::to_string);
        thread::spawn(move || {
            for _ in 0..expected_requests {
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = Vec::new();
                let mut buffer = [0u8; 4096];
                loop {
                    let read = stream.read(&mut buffer).unwrap();
                    if read == 0 {
                        break;
                    }
                    request.extend_from_slice(&buffer[..read]);
                    let Some(header_end) = request.windows(4).position(|w| w == b"\r\n\r\n") else {
                        continue;
                    };
                    let header_end = header_end + 4;
                    let headers = String::from_utf8_lossy(&request[..header_end]);
                    let content_length = headers
                        .lines()
                        .find_map(|line| {
                            line.strip_prefix("content-length: ")
                                .or_else(|| line.strip_prefix("Content-Length: "))
                        })
                        .and_then(|value| value.trim().parse::<usize>().ok())
                        .unwrap_or(0);
                    if request.len() >= header_end + content_length {
                        break;
                    }
                }
                let request_text = String::from_utf8_lossy(&request).to_string();
                tx.send(request_text.clone()).unwrap();
                let first_line = request_text.lines().next().unwrap_or_default();
                let review_url = "https://github.com/owner/repo/pull/42#pullrequestreview-99";
                let body = if first_line.contains("GET /repos/owner/repo/pulls/42 ") {
                    r#"{"number":42,"title":"Review me","html_url":"https://github.com/owner/repo/pull/42","state":"open","draft":false,"head":{"sha":"head-sha","ref":"feature"},"base":{"sha":"base-sha","ref":"main"}}"#.to_string()
                } else if first_line.contains("GET /repos/owner/repo/pulls/42/files?") {
                    patch_files(PATCH_CONTENT)
                } else if first_line.contains("GET /repos/owner/repo/git/blobs/blob-sha ") {
                    let content = base64::engine::general_purpose::STANDARD
                        .encode("fn safe() {}\nfn risky() { value.unwrap(); }\n");
                    format!(r#"{{"content":"{content}","encoding":"base64","size":48}}"#)
                } else if first_line.contains("GET /repos/owner/repo/pulls/42/reviews?") {
                    match existing_review_id {
                        Some(id) => format!(
                            r#"[{{"id":{id},"body":"SaCode PR Review\n\n{REVIEW_MARKER}","html_url":"{review_url}"}}]"#
                        ),
                        None => "[]".to_string(),
                    }
                } else if first_line.contains("GET /repos/owner/repo/pulls/42/comments?") {
                    match &existing_comment_body {
                        Some(existing) => format!(
                            r#"[{{"id":11,"body":{}}}]"#,
                            serde_json::to_string(existing).unwrap()
                        ),
                        None => "[]".to_string(),
                    }
                } else if first_line.contains("POST /repos/owner/repo/pulls/42/reviews ") {
                    format!(r#"{{"id":99,"html_url":"{review_url}"}}"#)
                } else {
                    r#"{"message":"not found"}"#.to_string()
                };
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(), body
                );
                stream.write_all(response.as_bytes()).unwrap();
            }
        });
        (format!("http://{address}"), rx)
    }

    const PATCH_CONTENT: &str = "@@ -1 +1,2 @@\n fn safe() {}\n+fn risky() { value.unwrap(); }";

    /// Embed a diff hunk into the files response JSON. A raw hunk contains real
    /// newlines, which are not legal inside a JSON string, so escape them.
    fn patch_files(patch_content: &str) -> String {
        let escaped = patch_content.replace('\\', "\\\\").replace('\n', "\\n");
        format!(
            r#"[{{"filename":"src/a.rs","status":"modified","sha":"blob-sha","patch":"{}"}}]"#,
            escaped
        )
    }

    #[test]
    fn parses_supported_github_remotes() {
        for remote in [
            "git@github.com:owner/repo.git",
            "ssh://git@github.com/owner/repo.git",
            "https://github.com/owner/repo.git",
        ] {
            assert_eq!(parse_github_remote(remote).unwrap().slug(), "owner/repo");
        }
        assert!(parse_github_remote("https://gitee.com/owner/repo.git").is_none());
        assert!(parse_github_remote("http://github.com/owner/repo.git").is_none());
    }

    #[test]
    fn parses_only_true_added_lines_from_github_patch() {
        let lines =
            parse_patch_added_lines("@@ -2,3 +3,4 @@\n context\n-old\n+new\n context2\n+extra\n");
        assert_eq!(lines, BTreeSet::from([4, 6]));
    }

    #[test]
    fn inline_comments_only_target_added_lines() {
        let findings = vec![
            Finding::new(
                "A",
                sacode_runtime::code_audit::Severity::High,
                "security",
                "src/a.rs",
                Some(3),
                "t",
                "d",
                "s",
                "heuristic",
            ),
            Finding::new(
                "B",
                sacode_runtime::code_audit::Severity::Low,
                "correctness",
                "src/a.rs",
                Some(7),
                "t",
                "d",
                "s",
                "heuristic",
            ),
        ];
        let changed = HashMap::from([("src/a.rs".to_string(), BTreeSet::from([3]))]);
        let (comments, already_posted) =
            build_inline_comments(&findings, &changed, &BTreeSet::new());
        assert_eq!(comments.len(), 1);
        assert_eq!(comments[0]["line"], 3);
        assert_eq!(comments[0]["side"], "RIGHT");
        assert_eq!(already_posted, 0);
    }

    #[test]
    fn inline_comments_skip_previously_posted_anchors() {
        let findings = vec![
            Finding::new(
                "A",
                sacode_runtime::code_audit::Severity::High,
                "security",
                "src/a.rs",
                Some(2),
                "t",
                "d",
                "s",
                "heuristic",
            ),
            Finding::new(
                "B",
                sacode_runtime::code_audit::Severity::Low,
                "correctness",
                "src/a.rs",
                Some(3),
                "t",
                "d",
                "s",
                "heuristic",
            ),
        ];
        let changed = HashMap::from([("src/a.rs".to_string(), BTreeSet::from([2, 3]))]);
        let posted = BTreeSet::from(["src/a.rs:2".to_string()]);
        let (comments, already_posted) = build_inline_comments(&findings, &changed, &posted);
        assert_eq!(already_posted, 1);
        assert_eq!(comments.len(), 1);
        assert_eq!(comments[0]["line"], 3);
    }

    fn sample_pr() -> PullRequestInfo {
        PullRequestInfo {
            number: 42,
            title: "Review me".into(),
            html_url: "https://github.com/owner/repo/pull/42".into(),
            state: "open".into(),
            draft: false,
            head: PullRequestRef {
                sha: "head-sha".into(),
                ref_name: "feature".into(),
                repo: Some(PullRequestRepo {
                    full_name: "owner/repo".into(),
                }),
            },
            base: PullRequestRef {
                sha: "base-sha".into(),
                ref_name: "main".into(),
                repo: Some(PullRequestRepo {
                    full_name: "owner/repo".into(),
                }),
            },
        }
    }

    fn pr_with(number: u64, head_repo: Option<&str>) -> PullRequestInfo {
        let mut pr = sample_pr();
        pr.number = number;
        pr.head.repo = head_repo.map(|full_name| PullRequestRepo {
            full_name: full_name.into(),
        });
        pr
    }

    #[test]
    fn select_pr_prefers_same_repo_head_over_fork() {
        let matches = vec![
            pr_with(1, Some("forker/repo")),
            pr_with(2, Some("owner/repo")),
        ];
        assert_eq!(
            select_pr(matches, "owner/repo", "feature").unwrap().number,
            2
        );
    }

    #[test]
    fn select_pr_rejects_ambiguous_forks() {
        let matches = vec![pr_with(1, Some("alice/repo")), pr_with(2, Some("bob/repo"))];
        let error = select_pr(matches, "owner/repo", "feature").unwrap_err();
        assert!(error.to_string().contains("多个开放 PR"));
    }

    #[test]
    fn select_pr_accepts_lone_fork_and_reports_missing_match() {
        let lone = vec![pr_with(5, Some("forker/repo"))];
        assert_eq!(select_pr(lone, "owner/repo", "feature").unwrap().number, 5);
        let error = select_pr(vec![], "owner/repo", "feature").unwrap_err();
        assert!(error.to_string().contains("未找到"));
    }

    #[test]
    fn review_payload_is_comment_on_head_commit() {
        let mut report = AuditReport::new(
            Path::new("."),
            vec![Finding::new(
                "A",
                sacode_runtime::code_audit::Severity::High,
                "security",
                "src/a.rs",
                Some(3),
                "t",
                "d",
                "s",
                "heuristic",
            )],
        );
        report.files_scanned = 1;
        report.changed_lines = 1;
        let changed = HashMap::from([("src/a.rs".to_string(), BTreeSet::from([3]))]);
        let (comments, _) = build_inline_comments(&report.findings, &changed, &BTreeSet::new());
        let payload = build_review_payload(&sample_pr(), &review_summary(&report), &comments);
        assert_eq!(payload["commit_id"], "head-sha");
        assert_eq!(payload["event"], "COMMENT");
        assert_eq!(payload["comments"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn comment_key_is_stable_and_cannot_close_the_marker() {
        assert_eq!(comment_key("src/a.rs", 2), "src/a.rs:2");
        let hostile = comment_key("a>b--c>.rs", 1);
        assert!(!hostile.contains('>'), "{hostile}");
        assert_eq!(hostile, "a_b--c_.rs:1");
    }

    #[test]
    fn inline_key_parsing_ignores_summary_and_increment_markers() {
        assert_eq!(
            extract_inline_key("body <!-- sacode:src/a.rs:2 --> tail"),
            Some("src/a.rs:2".to_string())
        );
        assert_eq!(extract_inline_key(REVIEW_MARKER), None);
        assert_eq!(extract_inline_key(&increment_summary(3)), None);
        assert_eq!(extract_inline_key("no marker here"), None);
    }

    #[test]
    fn canonical_review_prefers_oldest_marked_review() {
        let entry = |id: u64, body: &str| ReviewListEntry {
            id,
            body: Some(body.to_string()),
            html_url: None,
        };
        let reviews = vec![
            entry(90, &format!("## SaCode PR Review\n{REVIEW_MARKER}")),
            entry(95, &increment_summary(2)),
            entry(50, &format!("old\n{REVIEW_MARKER}")),
            entry(96, "unrelated review"),
        ];
        assert_eq!(find_canonical_review(&reviews).unwrap().id, 50);
        assert!(find_canonical_review(&[entry(96, "unrelated review")]).is_none());
    }

    #[test]
    fn increment_summary_is_not_mistaken_for_the_canonical_review() {
        let increment = increment_summary(2);
        assert!(increment.contains(INCREMENT_MARKER));
        assert!(!increment.contains(REVIEW_MARKER));
    }

    #[test]
    fn published_text_neutralizes_mentions_and_foreign_markers() {
        let sanitized = sanitize_github_text("@team <!-- injected -->");
        assert!(!sanitized.contains("@team"));
        assert!(!sanitized.contains("<!-- injected"));
    }

    #[test]
    fn review_summary_has_marker_and_counts() {
        let mut report = AuditReport::new(Path::new("."), vec![]);
        report.files_scanned = 2;
        report.changed_lines = 7;
        let summary = review_summary(&report);
        assert!(summary.contains("Reviewed files: 2"));
        assert!(summary.contains("<!-- sacode-audit-pr -->"));
    }

    #[tokio::test]
    async fn github_api_flow_fetches_pr_diff_and_publishes_review() {
        let (api_base, requests) = spawn_github_mock(None, None, 6);
        let client = GitHubPrClient::with_api_base("secret-token".into(), api_base).unwrap();
        let repo = GitHubRepo::parse("owner/repo").unwrap();
        let pr = client.resolve_pr(&repo, Some(42), "feature").await.unwrap();
        let diff = client.fetch_diff(&repo, pr, 400).await.unwrap();
        assert_eq!(diff.changed_lines["src/a.rs"], BTreeSet::from([2]));
        assert!(diff.contents["src/a.rs"].contains("value.unwrap"));

        let findings =
            sacode_runtime::code_audit::scan_changed_lines(&diff.contents, &diff.changed_lines, 50);
        let mut report = AuditReport::new(Path::new("."), findings);
        report.files_scanned = 1;
        report.changed_lines = 1;
        let review = client
            .publish_review(&repo, &diff.pr, &report, &diff.changed_lines)
            .await
            .unwrap();
        assert_eq!(review.review_id, 99);
        assert_eq!(review.comments, 1);
        assert_eq!(
            review.posted_review,
            Some(99),
            "first publish must create the review"
        );
        assert_eq!(review.existing_review_id, None);

        let captured = (0..6)
            .map(|_| requests.recv_timeout(Duration::from_secs(1)).unwrap())
            .collect::<Vec<_>>();
        assert!(captured.iter().all(|request| {
            request.contains("authorization: Bearer secret-token")
                || request.contains("Authorization: Bearer secret-token")
        }));
        let publish = captured
            .iter()
            .find(|request| request.starts_with("POST "))
            .unwrap();
        assert!(publish.contains("\"event\":\"COMMENT\""));
        assert!(publish.contains("\"line\":2"));
        assert!(!publish.contains("\"line\":1"));
        assert!(captured
            .iter()
            .any(|request| request.starts_with("GET /repos/owner/repo/pulls/42/comments?")));
    }

    /// Re-running `--publish` on a PR that already has a SaCode summary review
    /// and no new findings must not post anything: the summary cannot be edited
    /// in place (`COMMENT` reviews are not PATCH-able), and reposting would only
    /// create a duplicate.
    #[tokio::test]
    async fn republish_with_no_new_findings_posts_nothing() {
        let (api_base, requests) = spawn_github_mock(
            Some(77),
            Some("**high · A** — t\n\n<!-- sacode:src/a.rs:2 -->"),
            5,
        );
        let client = GitHubPrClient::with_api_base("secret-token".into(), api_base).unwrap();
        let repo = GitHubRepo::parse("owner/repo").unwrap();
        let pr = client.resolve_pr(&repo, Some(42), "feature").await.unwrap();
        let diff = client.fetch_diff(&repo, pr, 400).await.unwrap();

        let findings =
            sacode_runtime::code_audit::scan_changed_lines(&diff.contents, &diff.changed_lines, 50);
        let mut report = AuditReport::new(Path::new("."), findings);
        report.files_scanned = 1;
        report.changed_lines = 1;
        let review = client
            .publish_review(&repo, &diff.pr, &report, &diff.changed_lines)
            .await
            .unwrap();
        assert_eq!(review.review_id, 77);
        assert_eq!(review.existing_review_id, Some(77));
        assert_eq!(review.posted_review, None, "nothing new may be posted");
        assert_eq!(review.comments, 0);
        assert_eq!(review.skipped_existing_comments, 1);

        let captured = (0..5)
            .map(|_| requests.recv_timeout(Duration::from_secs(1)).unwrap())
            .collect::<Vec<_>>();
        assert!(
            !captured.iter().any(|request| request.starts_with("POST ")),
            "re-publish created a duplicate review:\n{}",
            captured.join("\n")
        );
        assert!(captured
            .iter()
            .any(|request| request.starts_with("GET /repos/owner/repo/pulls/42/reviews?")));
        assert!(captured
            .iter()
            .any(|request| request.starts_with("GET /repos/owner/repo/pulls/42/comments?")));
    }

    /// With an existing summary review but findings not yet commented on, the
    /// re-run must post an increment review carrying only those inline comments.
    #[tokio::test]
    async fn republish_with_new_findings_posts_an_increment_review() {
        let (api_base, requests) = spawn_github_mock(
            Some(77),
            None, // no inline comment on src/a.rs:2 yet
            6,
        );
        let client = GitHubPrClient::with_api_base("secret-token".into(), api_base).unwrap();
        let repo = GitHubRepo::parse("owner/repo").unwrap();
        let pr = client.resolve_pr(&repo, Some(42), "feature").await.unwrap();
        let diff = client.fetch_diff(&repo, pr, 400).await.unwrap();

        let findings =
            sacode_runtime::code_audit::scan_changed_lines(&diff.contents, &diff.changed_lines, 50);
        let mut report = AuditReport::new(Path::new("."), findings);
        report.files_scanned = 1;
        report.changed_lines = 1;
        let review = client
            .publish_review(&repo, &diff.pr, &report, &diff.changed_lines)
            .await
            .unwrap();
        assert_eq!(review.review_id, 77);
        assert_eq!(review.existing_review_id, Some(77));
        assert_eq!(review.comments, 1);
        assert_eq!(review.skipped_existing_comments, 0);

        let captured = (0..6)
            .map(|_| requests.recv_timeout(Duration::from_secs(1)).unwrap())
            .collect::<Vec<_>>();
        let posts: Vec<_> = captured
            .iter()
            .filter(|request| request.starts_with("POST "))
            .collect();
        assert_eq!(posts.len(), 1, "exactly one increment review is posted");
        let post = &posts[0];
        assert!(post.contains("/reviews "));
        assert!(post.contains("\"line\":2"));
        // The increment body carries the increment marker, never the summary one,
        // so the next run still treats review 77 as the canonical summary.
        assert!(post.contains(INCREMENT_MARKER));
        assert!(!post.contains(REVIEW_MARKER));
    }
}
