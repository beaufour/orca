use crate::command::expand_tilde;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionSummary {
    pub summary: Option<String>,
    pub initial_prompt: Option<String>,
    pub attention: AttentionStatus,
    pub last_tool: Option<String>,
    pub last_text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AttentionStatus {
    NeedsInput,
    Error,
    Running,
    Idle,
    Stale,
    Unknown,
}

fn claude_projects_dir() -> Option<PathBuf> {
    Some(dirs::home_dir()?.join(".claude/projects"))
}

pub fn find_jsonl_path(project_path: &str, claude_session_id: &str) -> Option<PathBuf> {
    // Expand tilde before encoding path
    let expanded = expand_tilde(project_path);
    let expanded_str = expanded.to_string_lossy();
    let encoded = expanded_str.replace('/', "-");
    let base = claude_projects_dir()?;

    log::debug!(
        "find_jsonl_path: searching for session {claude_session_id} in {}",
        base.display()
    );

    // Try the exact encoded path first
    let candidate = base
        .join(&encoded)
        .join(format!("{claude_session_id}.jsonl"));
    if candidate.exists() {
        log::debug!(
            "find_jsonl_path: found exact match at {}",
            candidate.display()
        );
        return Some(candidate);
    }

    // Try subdirectories that start with the encoded path (for worktrees)
    if let Ok(entries) = std::fs::read_dir(&base) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with(&encoded) {
                let candidate = entry.path().join(format!("{claude_session_id}.jsonl"));
                if candidate.exists() {
                    log::debug!(
                        "find_jsonl_path: found worktree match at {}",
                        candidate.display()
                    );
                    return Some(candidate);
                }
            }
        }
    }

    log::debug!("find_jsonl_path: no JSONL file found for session {claude_session_id}");
    None
}

/// Return the session id (JSONL stem) of the most-recently-modified top-level
/// `.jsonl` in a directory. Ignores subdirectories (e.g. `subagents/`).
fn latest_session_id_in_dir(dir: &Path) -> Option<String> {
    let mut best: Option<(SystemTime, String)> = None;
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        let Ok(mtime) = entry.metadata().and_then(|m| m.modified()) else {
            continue;
        };
        if best.as_ref().map(|(t, _)| *t < mtime).unwrap_or(true) {
            best = Some((mtime, stem.to_string()));
        }
    }
    best.map(|(_, id)| id)
}

/// Find the session id of the newest JSONL for a given project path. Used on
/// restart so that if the user ran `/clear` and chatted again (producing a
/// fresh JSONL), we resume the new session rather than the stale stored one.
///
/// Mirrors [`find_jsonl_path`]'s directory-lookup strategy: exact encoded path
/// first, falling back to sibling directories that start with the encoded path
/// (Claude Code sometimes appends a suffix for worktrees).
pub fn find_latest_session_id(project_path: &str) -> Option<String> {
    let expanded = expand_tilde(project_path);
    let encoded = expanded.to_string_lossy().replace('/', "-");
    let base = claude_projects_dir()?;

    if let Some(id) = latest_session_id_in_dir(&base.join(&encoded)) {
        return Some(id);
    }

    // Fallback: scan sibling dirs starting with the encoded path and pick the
    // globally-newest JSONL across them.
    let mut best: Option<(SystemTime, String)> = None;
    for entry in std::fs::read_dir(&base).ok()?.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name == encoded || !name.starts_with(&encoded) {
            continue;
        }
        let Some(id) = latest_session_id_in_dir(&entry.path()) else {
            continue;
        };
        let jsonl = entry.path().join(format!("{id}.jsonl"));
        let Ok(mtime) = std::fs::metadata(&jsonl).and_then(|m| m.modified()) else {
            continue;
        };
        if best.as_ref().map(|(t, _)| *t < mtime).unwrap_or(true) {
            best = Some((mtime, id));
        }
    }
    best.map(|(_, id)| id)
}

/// Extract the most recent Claude Code `version` field from a session's JSONL.
/// Claude Code writes `"version":"X.Y.Z"` on message records, so the latest
/// line tells us which binary is actually running the session. Returns None
/// when no JSONL exists or no version field is found.
pub fn extract_session_version(project_path: &str, claude_session_id: &str) -> Option<String> {
    let jsonl_path = find_jsonl_path(project_path, claude_session_id)?;
    // 128KB of tail is more than enough for the latest version field.
    let lines = read_tail_lines(&jsonl_path, 128 * 1024);
    for line in lines.iter().rev() {
        if let Some(v) = line.get("version").and_then(|v| v.as_str()) {
            if !v.is_empty() {
                return Some(v.to_string());
            }
        }
    }
    None
}

/// Read the last N bytes of a file and parse JSONL lines from it
fn read_tail_lines(path: &Path, max_bytes: u64) -> Vec<serde_json::Value> {
    let Ok(file) = File::open(path) else {
        log::warn!("read_tail_lines: failed to open {}", path.display());
        return vec![];
    };

    let Ok(metadata) = file.metadata() else {
        log::warn!(
            "read_tail_lines: failed to read metadata for {}",
            path.display()
        );
        return vec![];
    };

    let file_size = metadata.len();
    let seek_pos = file_size.saturating_sub(max_bytes);
    log::debug!(
        "read_tail_lines: file_size={file_size}, seek_pos={seek_pos} for {}",
        path.display()
    );

    let mut reader = BufReader::new(file);
    if reader.seek(SeekFrom::Start(seek_pos)).is_err() {
        return vec![];
    }

    // If we seeked to the middle, skip the first partial line
    if seek_pos > 0 {
        let mut discard = String::new();
        let _ = reader.read_line(&mut discard);
    }

    let mut lines = Vec::new();
    for line in reader.lines() {
        let Ok(line) = line else {
            continue;
        };
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) {
            lines.push(val);
        }
    }
    lines
}

/// Read the first N bytes of a file and parse JSONL lines from it
fn read_head_lines(path: &Path, max_bytes: u64) -> Vec<serde_json::Value> {
    let Ok(file) = File::open(path) else {
        return vec![];
    };

    let reader = BufReader::new(file);
    let mut lines = Vec::new();
    let mut bytes_read: u64 = 0;

    for line in reader.lines() {
        let Ok(line) = line else {
            continue;
        };
        bytes_read += line.len() as u64 + 1;
        if bytes_read > max_bytes {
            break;
        }
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) {
            lines.push(val);
        }
    }
    lines
}

fn extract_initial_prompt(lines: &[serde_json::Value]) -> Option<String> {
    for line in lines.iter() {
        let msg = line.get("message").unwrap_or(line);
        if msg.get("role").and_then(|v| v.as_str()) != Some("user") {
            continue;
        }
        if let Some(content) = msg.get("content").and_then(|v| v.as_array()) {
            for item in content {
                if item.get("type").and_then(|v| v.as_str()) == Some("text") {
                    let text = item.get("text").and_then(|v| v.as_str()).unwrap_or("");
                    let trimmed = text.trim();
                    if !trimmed.is_empty() {
                        let truncated: String = trimmed.chars().take(200).collect();
                        return Some(truncated);
                    }
                }
            }
        }
    }
    None
}

fn extract_summary(lines: &[serde_json::Value]) -> Option<String> {
    // Look for type=summary entries (most recent wins)
    for line in lines.iter().rev() {
        if line.get("type").and_then(|v| v.as_str()) == Some("summary") {
            if let Some(s) = line.get("summary").and_then(|v| v.as_str()) {
                return Some(s.to_string());
            }
        }
    }
    None
}

fn extract_attention(lines: &[serde_json::Value], agentdeck_status: &str) -> AttentionStatus {
    // For all statuses (including "running" and "waiting"), refine using JSONL
    let relevant: Vec<&serde_json::Value> = lines
        .iter()
        .filter(|l| {
            let t = l.get("type").and_then(|v| v.as_str()).unwrap_or("");
            t == "assistant" || t == "user"
        })
        .collect();

    // Agent-deck "waiting" means the CLI is at a prompt, but only flag as
    // NeedsInput if there has been an actual conversation (assistant messages).
    // A fresh session with no assistant messages is just the initial prompt — Idle.
    if agentdeck_status == "waiting" {
        let has_assistant = relevant.iter().any(|entry| {
            let msg = entry.get("message").unwrap_or(entry);
            msg.get("role").and_then(|v| v.as_str()) == Some("assistant")
        });
        if has_assistant {
            return AttentionStatus::NeedsInput;
        } else {
            return AttentionStatus::Idle;
        }
    }

    if relevant.is_empty() {
        // No JSONL data — trust agent-deck status
        return match agentdeck_status {
            "running" => AttentionStatus::Running,
            "error" => AttentionStatus::Error,
            _ => AttentionStatus::Unknown,
        };
    }

    let last = relevant.last().unwrap();
    let msg = last.get("message").unwrap_or(last);
    let role = msg.get("role").and_then(|v| v.as_str()).unwrap_or("");
    let content = msg.get("content").and_then(|v| v.as_array());

    if role == "assistant" {
        if let Some(content_arr) = content {
            for item in content_arr {
                if item.get("type").and_then(|v| v.as_str()) == Some("tool_use") {
                    let name = item.get("name").and_then(|v| v.as_str()).unwrap_or("");

                    // Explicit user-facing prompts — these tools always
                    // require user interaction regardless of auto-approve
                    // settings.
                    if name == "AskUserQuestion"
                        || name == "ExitPlanMode"
                        || name == "EnterPlanMode"
                    {
                        return AttentionStatus::NeedsInput;
                    }

                    // NOTE: We do NOT flag generic tool_use-without-result as
                    // NeedsInput.  A missing tool_result can mean either
                    // "waiting for user approval" or "tool currently executing"
                    // — we can't tell which from JSONL alone.  False "Needs
                    // Input" during every tool execution is worse than showing
                    // "Running" during an actual permission prompt.
                }
            }
        }
    }

    // NOTE: We intentionally do NOT check tool_result is_error here.
    // The is_error flag on tool_results covers normal workflow events like
    // rejected tool calls, rejected plans (ExitPlanMode), and failed bash
    // commands — none of which are session-level errors.  If the session
    // truly errored out, agent-deck will report "error" status and the
    // catch-all below handles it.

    // Check staleness based on timestamp
    if let Some(ts) = lines
        .last()
        .and_then(|l| l.get("timestamp").and_then(serde_json::Value::as_f64))
    {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs_f64();
        if now - ts > 3600.0 {
            return AttentionStatus::Stale;
        }
    }

    if agentdeck_status == "running" {
        return AttentionStatus::Running;
    }

    if agentdeck_status == "error" {
        return AttentionStatus::Error;
    }

    AttentionStatus::Idle
}

fn extract_last_text(lines: &[serde_json::Value]) -> Option<String> {
    for line in lines.iter().rev() {
        let msg = line.get("message").unwrap_or(line);
        if msg.get("role").and_then(|v| v.as_str()) != Some("assistant") {
            continue;
        }
        if let Some(content) = msg.get("content").and_then(|v| v.as_array()) {
            for item in content {
                if item.get("type").and_then(|v| v.as_str()) == Some("text") {
                    let text = item.get("text").and_then(|v| v.as_str()).unwrap_or("");
                    let trimmed = text.trim();
                    if !trimmed.is_empty() {
                        // Return first ~200 chars
                        let truncated: String = trimmed.chars().take(200).collect();
                        return Some(truncated);
                    }
                }
            }
        }
    }
    None
}

fn extract_last_tool(lines: &[serde_json::Value]) -> Option<String> {
    for line in lines.iter().rev() {
        let msg = line.get("message").unwrap_or(line);
        if msg.get("role").and_then(|v| v.as_str()) != Some("assistant") {
            continue;
        }
        if let Some(content) = msg.get("content").and_then(|v| v.as_array()) {
            for item in content {
                if item.get("type").and_then(|v| v.as_str()) == Some("tool_use") {
                    return item.get("name").and_then(|v| v.as_str()).map(String::from);
                }
            }
        }
    }
    None
}

/// Compute just the attention status for a session (lightweight — skips summary/tool extraction).
pub fn compute_attention(
    project_path: &str,
    claude_session_id: Option<&str>,
    agentdeck_status: &str,
    tmux_session: Option<&str>,
) -> AttentionStatus {
    log::debug!(
        "compute_attention: session_id={claude_session_id:?}, agentdeck_status={agentdeck_status}, tmux={tmux_session:?}"
    );

    // Hook events from Claude Code are the most accurate signal for live
    // sessions (Notification/Stop fire exactly when Claude is waiting on the
    // user). We trust them when tmux is alive — if it's not, the session is
    // dormant and we'd rather rely on JSONL/agentdeck heuristics that can
    // surface "Idle"/"Stale". "Error" still wins because hooks don't report
    // crashes.
    if agentdeck_status != "error" {
        if let Some(status) = attention_from_hook_event(claude_session_id, tmux_session) {
            log::debug!("compute_attention: hook signal -> {status:?}");
            return status;
        }
    }

    let Some(claude_session_id) = claude_session_id else {
        let attention = match agentdeck_status {
            "running" => AttentionStatus::Running,
            "waiting" => AttentionStatus::Idle,
            "error" => AttentionStatus::Error,
            _ => AttentionStatus::Unknown,
        };
        return refine_with_tmux(attention, tmux_session);
    };

    let Some(jsonl_path) = find_jsonl_path(project_path, claude_session_id) else {
        let attention = match agentdeck_status {
            "running" => AttentionStatus::Running,
            "waiting" => AttentionStatus::Idle,
            "error" => AttentionStatus::Error,
            "idle" => AttentionStatus::Idle,
            _ => AttentionStatus::Unknown,
        };
        return refine_with_tmux(attention, tmux_session);
    };

    let lines = read_tail_lines(&jsonl_path, 256 * 1024);
    let result = refine_with_tmux(extract_attention(&lines, agentdeck_status), tmux_session);
    log::debug!("compute_attention: result={result:?}");
    result
}

/// Translate the latest hook event for a session into an attention status.
/// Returns None when there is no event, no live tmux, or the event type is
/// one we don't act on — caller falls back to JSONL/tmux heuristics.
fn attention_from_hook_event(
    claude_session_id: Option<&str>,
    tmux_session: Option<&str>,
) -> Option<AttentionStatus> {
    let csid = claude_session_id?;
    let ts = tmux_session?;
    if ts.is_empty() || !crate::tmux::is_tmux_session_alive(ts) {
        return None;
    }
    let event = crate::claude_hooks::latest_event_for(csid)?;
    match event.event.as_str() {
        "Notification" | "Stop" => Some(AttentionStatus::NeedsInput),
        "UserPromptSubmit" => Some(AttentionStatus::Running),
        _ => None,
    }
}

/// Refine attention status by checking the tmux session.
///
/// - `Running` + tmux shows input prompt → `NeedsInput`
/// - `Idle` + tmux session alive → `NeedsInput` (DB status is stale; session is actually active)
fn refine_with_tmux(attention: AttentionStatus, tmux_session: Option<&str>) -> AttentionStatus {
    let Some(ts) = tmux_session else {
        return attention;
    };
    if ts.is_empty() {
        return attention;
    }

    match attention {
        AttentionStatus::Running if crate::tmux::is_waiting_for_input(ts) => {
            log::debug!("refine_with_tmux: tmux check upgraded Running -> NeedsInput for {ts}");
            AttentionStatus::NeedsInput
        }
        AttentionStatus::Idle if crate::tmux::is_tmux_session_alive(ts) => {
            log::debug!(
                "refine_with_tmux: tmux session alive, upgraded Idle -> NeedsInput for {ts}"
            );
            AttentionStatus::NeedsInput
        }
        _ => attention,
    }
}

#[tauri::command]
pub fn get_session_summary(
    project_path: String,
    claude_session_id: String,
    agentdeck_status: String,
    tmux_session: Option<String>,
) -> SessionSummary {
    // Hook events take precedence (when tmux is alive and not in error state),
    // matching the logic in compute_attention so both code paths agree.
    let hook_attention = (agentdeck_status != "error")
        .then(|| attention_from_hook_event(Some(&claude_session_id), tmux_session.as_deref()))
        .flatten();

    let Some(jsonl_path) = find_jsonl_path(&project_path, &claude_session_id) else {
        log::debug!("get_session_summary: no JSONL for session {claude_session_id}, using agentdeck_status={agentdeck_status}");
        let final_attention = match hook_attention {
            Some(a) => a, // hook signal is authoritative
            None => {
                let fallback = match agentdeck_status.as_str() {
                    "running" => AttentionStatus::Running,
                    // No JSONL file means no conversation yet — just the initial prompt
                    "waiting" => AttentionStatus::Idle,
                    "error" => AttentionStatus::Error,
                    "idle" => AttentionStatus::Idle,
                    _ => AttentionStatus::Unknown,
                };
                refine_with_tmux(fallback, tmux_session.as_deref())
            }
        };
        return SessionSummary {
            summary: None,
            initial_prompt: None,
            attention: final_attention,
            last_tool: None,
            last_text: None,
        };
    };

    log::debug!(
        "get_session_summary: reading JSONL at {}",
        jsonl_path.display()
    );

    // Read last 256KB of the file
    let lines = read_tail_lines(&jsonl_path, 256 * 1024);
    let final_attention = hook_attention.unwrap_or_else(|| {
        refine_with_tmux(
            extract_attention(&lines, &agentdeck_status),
            tmux_session.as_deref(),
        )
    });

    log::debug!(
        "get_session_summary: attention={final_attention:?} for session {claude_session_id}"
    );

    // Read initial prompt from the head of the file
    let head_lines = read_head_lines(&jsonl_path, 32 * 1024);
    let initial_prompt = extract_initial_prompt(&head_lines);

    SessionSummary {
        summary: extract_summary(&lines),
        initial_prompt,
        attention: final_attention,
        last_tool: extract_last_tool(&lines),
        last_text: extract_last_text(&lines),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // ── extract_summary ──

    #[test]
    fn summary_empty_lines() {
        assert_eq!(extract_summary(&[]), None);
    }

    #[test]
    fn summary_single() {
        let lines = vec![json!({"type": "summary", "summary": "Did some work"})];
        assert_eq!(extract_summary(&lines), Some("Did some work".into()));
    }

    #[test]
    fn summary_latest_wins() {
        let lines = vec![
            json!({"type": "summary", "summary": "First"}),
            json!({"type": "assistant", "message": {"role": "assistant"}}),
            json!({"type": "summary", "summary": "Second"}),
        ];
        assert_eq!(extract_summary(&lines), Some("Second".into()));
    }

    #[test]
    fn summary_no_summary_field() {
        let lines = vec![json!({"type": "summary"})];
        assert_eq!(extract_summary(&lines), None);
    }

    #[test]
    fn summary_ignores_non_summary_types() {
        let lines = vec![json!({"type": "assistant", "summary": "Not a summary entry"})];
        assert_eq!(extract_summary(&lines), None);
    }

    // ── extract_attention ──

    #[test]
    fn attention_waiting_with_assistant() {
        let lines = vec![json!({
            "type": "assistant",
            "message": {"role": "assistant", "content": [{"type": "text", "text": "hello"}]}
        })];
        assert!(matches!(
            extract_attention(&lines, "waiting"),
            AttentionStatus::NeedsInput
        ));
    }

    #[test]
    fn attention_waiting_no_assistant() {
        let lines = vec![json!({
            "type": "user",
            "message": {"role": "user", "content": [{"type": "text", "text": "hello"}]}
        })];
        assert!(matches!(
            extract_attention(&lines, "waiting"),
            AttentionStatus::Idle
        ));
    }

    #[test]
    fn attention_empty_lines_running() {
        assert!(matches!(
            extract_attention(&[], "running"),
            AttentionStatus::Running
        ));
    }

    #[test]
    fn attention_empty_lines_error() {
        assert!(matches!(
            extract_attention(&[], "error"),
            AttentionStatus::Error
        ));
    }

    #[test]
    fn attention_empty_lines_unknown() {
        assert!(matches!(
            extract_attention(&[], "something"),
            AttentionStatus::Unknown
        ));
    }

    #[test]
    fn attention_ask_user_question_tool() {
        let lines = vec![json!({
            "type": "assistant",
            "message": {"role": "assistant", "content": [
                {"type": "tool_use", "name": "AskUserQuestion"}
            ]}
        })];
        assert!(matches!(
            extract_attention(&lines, "running"),
            AttentionStatus::NeedsInput
        ));
    }

    #[test]
    fn attention_exit_plan_mode_tool() {
        let lines = vec![json!({
            "type": "assistant",
            "message": {"role": "assistant", "content": [
                {"type": "tool_use", "name": "ExitPlanMode"}
            ]}
        })];
        assert!(matches!(
            extract_attention(&lines, "running"),
            AttentionStatus::NeedsInput
        ));
    }

    #[test]
    fn attention_enter_plan_mode_tool() {
        let lines = vec![json!({
            "type": "assistant",
            "message": {"role": "assistant", "content": [
                {"type": "tool_use", "name": "EnterPlanMode"}
            ]}
        })];
        assert!(matches!(
            extract_attention(&lines, "running"),
            AttentionStatus::NeedsInput
        ));
    }

    #[test]
    fn attention_stale_timestamp() {
        let old_ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs_f64()
            - 7200.0; // 2 hours ago
        let lines = vec![
            json!({
                "type": "assistant",
                "message": {"role": "assistant", "content": [{"type": "text", "text": "hi"}]}
            }),
            json!({"type": "result", "timestamp": old_ts}),
        ];
        assert!(matches!(
            extract_attention(&lines, "running"),
            AttentionStatus::Stale
        ));
    }

    #[test]
    fn attention_running_fallback() {
        let recent_ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs_f64()
            - 10.0;
        let lines = vec![
            json!({
                "type": "assistant",
                "message": {"role": "assistant", "content": [{"type": "text", "text": "working"}]}
            }),
            json!({"type": "result", "timestamp": recent_ts}),
        ];
        assert!(matches!(
            extract_attention(&lines, "running"),
            AttentionStatus::Running
        ));
    }

    #[test]
    fn attention_error_fallback() {
        let recent_ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs_f64()
            - 10.0;
        let lines = vec![
            json!({
                "type": "assistant",
                "message": {"role": "assistant", "content": [{"type": "text", "text": "oops"}]}
            }),
            json!({"type": "result", "timestamp": recent_ts}),
        ];
        assert!(matches!(
            extract_attention(&lines, "error"),
            AttentionStatus::Error
        ));
    }

    #[test]
    fn attention_default_idle() {
        let recent_ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs_f64()
            - 10.0;
        let lines = vec![
            json!({
                "type": "assistant",
                "message": {"role": "assistant", "content": [{"type": "text", "text": "done"}]}
            }),
            json!({"type": "result", "timestamp": recent_ts}),
        ];
        assert!(matches!(
            extract_attention(&lines, "idle"),
            AttentionStatus::Idle
        ));
    }

    // ── extract_last_text ──

    #[test]
    fn last_text_no_lines() {
        assert_eq!(extract_last_text(&[]), None);
    }

    #[test]
    fn last_text_no_assistant() {
        let lines = vec![json!({
            "type": "user",
            "message": {"role": "user", "content": [{"type": "text", "text": "hello"}]}
        })];
        assert_eq!(extract_last_text(&lines), None);
    }

    #[test]
    fn last_text_returns_text() {
        let lines = vec![json!({
            "type": "assistant",
            "message": {"role": "assistant", "content": [
                {"type": "text", "text": "Here is the answer"}
            ]}
        })];
        assert_eq!(extract_last_text(&lines), Some("Here is the answer".into()));
    }

    #[test]
    fn last_text_truncates_at_200_chars() {
        let long_text = "a".repeat(300);
        let lines = vec![json!({
            "type": "assistant",
            "message": {"role": "assistant", "content": [
                {"type": "text", "text": long_text}
            ]}
        })];
        let result = extract_last_text(&lines).unwrap();
        assert_eq!(result.len(), 200);
    }

    // ── extract_last_tool ──

    #[test]
    fn last_tool_no_lines() {
        assert_eq!(extract_last_tool(&[]), None);
    }

    #[test]
    fn last_tool_with_tool_use() {
        let lines = vec![json!({
            "type": "assistant",
            "message": {"role": "assistant", "content": [
                {"type": "tool_use", "name": "Read"}
            ]}
        })];
        assert_eq!(extract_last_tool(&lines), Some("Read".into()));
    }

    #[test]
    fn last_tool_no_tool_use() {
        let lines = vec![json!({
            "type": "assistant",
            "message": {"role": "assistant", "content": [
                {"type": "text", "text": "just text"}
            ]}
        })];
        assert_eq!(extract_last_tool(&lines), None);
    }

    // ── refine_with_tmux ──

    #[test]
    fn refine_with_tmux_no_session() {
        // No tmux session — status unchanged
        let result = refine_with_tmux(AttentionStatus::Idle, None);
        assert!(matches!(result, AttentionStatus::Idle));
    }

    #[test]
    fn refine_with_tmux_empty_session() {
        // Empty tmux session string — status unchanged
        let result = refine_with_tmux(AttentionStatus::Idle, Some(""));
        assert!(matches!(result, AttentionStatus::Idle));
    }

    #[test]
    fn refine_with_tmux_nonexistent_session_idle() {
        // Non-existent tmux session — is_tmux_session_alive returns false, stays Idle
        let result = refine_with_tmux(AttentionStatus::Idle, Some("nonexistent-session-xyz-999"));
        assert!(matches!(result, AttentionStatus::Idle));
    }

    #[test]
    fn refine_with_tmux_nonexistent_session_running() {
        // Non-existent tmux session — is_waiting_for_input returns false, stays Running
        let result = refine_with_tmux(
            AttentionStatus::Running,
            Some("nonexistent-session-xyz-999"),
        );
        assert!(matches!(result, AttentionStatus::Running));
    }

    // ── version extraction ──
    // extract_session_version depends on file I/O, so we test the inner lookup
    // logic against parsed JSONL values directly.

    fn latest_version(lines: &[serde_json::Value]) -> Option<String> {
        for line in lines.iter().rev() {
            if let Some(v) = line.get("version").and_then(|v| v.as_str()) {
                if !v.is_empty() {
                    return Some(v.to_string());
                }
            }
        }
        None
    }

    #[test]
    fn version_latest_line_wins() {
        let lines = vec![
            json!({"type": "assistant", "version": "2.1.69"}),
            json!({"type": "user"}),
            json!({"type": "assistant", "version": "2.1.114"}),
        ];
        assert_eq!(latest_version(&lines), Some("2.1.114".into()));
    }

    #[test]
    fn version_none_when_missing() {
        let lines = vec![json!({"type": "user"}), json!({"type": "assistant"})];
        assert_eq!(latest_version(&lines), None);
    }

    // ── latest_session_id_in_dir ──

    #[test]
    fn latest_session_id_picks_newest_jsonl() {
        let tmp = tempfile::tempdir().unwrap();
        let older = tmp
            .path()
            .join("aaaaaaaa-0000-0000-0000-000000000001.jsonl");
        let newer = tmp
            .path()
            .join("bbbbbbbb-0000-0000-0000-000000000002.jsonl");
        std::fs::write(&older, "{}").unwrap();
        // Sleep briefly so mtimes differ on filesystems with second resolution.
        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::write(&newer, "{}").unwrap();

        let id = latest_session_id_in_dir(tmp.path()).unwrap();
        assert_eq!(id, "bbbbbbbb-0000-0000-0000-000000000002");
    }

    #[test]
    fn latest_session_id_ignores_non_jsonl() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("foo.txt"), "nope").unwrap();
        std::fs::write(tmp.path().join("session-1.jsonl"), "{}").unwrap();
        let id = latest_session_id_in_dir(tmp.path()).unwrap();
        assert_eq!(id, "session-1");
    }

    #[test]
    fn latest_session_id_ignores_subdirs() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("session-1.jsonl"), "{}").unwrap();
        let sub = tmp.path().join("subagents");
        std::fs::create_dir(&sub).unwrap();
        std::fs::write(sub.join("agent-aaa.jsonl"), "{}").unwrap();
        let id = latest_session_id_in_dir(tmp.path()).unwrap();
        assert_eq!(id, "session-1");
    }

    #[test]
    fn latest_session_id_empty_dir() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(latest_session_id_in_dir(tmp.path()), None);
    }

    #[test]
    fn latest_session_id_missing_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let missing = tmp.path().join("does-not-exist");
        assert_eq!(latest_session_id_in_dir(&missing), None);
    }

    #[test]
    fn version_skips_empty_string() {
        let lines = vec![
            json!({"type": "assistant", "version": "2.1.69"}),
            json!({"type": "assistant", "version": ""}),
        ];
        assert_eq!(latest_version(&lines), Some("2.1.69".into()));
    }

    #[test]
    fn refine_with_tmux_preserves_other_statuses() {
        // Error, Stale, NeedsInput, Unknown should pass through unchanged
        assert!(matches!(
            refine_with_tmux(AttentionStatus::Error, Some("any")),
            AttentionStatus::Error
        ));
        assert!(matches!(
            refine_with_tmux(AttentionStatus::Stale, Some("any")),
            AttentionStatus::Stale
        ));
        assert!(matches!(
            refine_with_tmux(AttentionStatus::NeedsInput, Some("any")),
            AttentionStatus::NeedsInput
        ));
        assert!(matches!(
            refine_with_tmux(AttentionStatus::Unknown, Some("any")),
            AttentionStatus::Unknown
        ));
    }
}
