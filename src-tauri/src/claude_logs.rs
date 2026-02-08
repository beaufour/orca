use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionSummary {
    pub summary: Option<String>,
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

fn claude_projects_dir() -> PathBuf {
    let home = dirs::home_dir().expect("could not find home directory");
    home.join(".claude/projects")
}

fn find_jsonl_path(project_path: &str, claude_session_id: &str) -> Option<PathBuf> {
    let encoded = project_path.replace('/', "-");
    let base = claude_projects_dir();

    // Try the exact encoded path first
    let candidate = base
        .join(&encoded)
        .join(format!("{claude_session_id}.jsonl"));
    if candidate.exists() {
        return Some(candidate);
    }

    // Try subdirectories that start with the encoded path (for worktrees)
    if let Ok(entries) = std::fs::read_dir(&base) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with(&encoded) {
                let candidate = entry.path().join(format!("{claude_session_id}.jsonl"));
                if candidate.exists() {
                    return Some(candidate);
                }
            }
        }
    }

    None
}

/// Read the last N bytes of a file and parse JSONL lines from it
fn read_tail_lines(path: &PathBuf, max_bytes: u64) -> Vec<serde_json::Value> {
    let Ok(file) = File::open(path) else {
        return vec![];
    };

    let Ok(metadata) = file.metadata() else {
        return vec![];
    };

    let file_size = metadata.len();
    let seek_pos = file_size.saturating_sub(max_bytes);

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
    refine_with_tmux(extract_attention(&lines, agentdeck_status), tmux_session)
}

/// Refine a Running status by checking the tmux pane for a permission prompt.
fn refine_with_tmux(attention: AttentionStatus, tmux_session: Option<&str>) -> AttentionStatus {
    if matches!(attention, AttentionStatus::Running) {
        if let Some(ts) = tmux_session {
            if !ts.is_empty() && crate::tmux::is_waiting_for_input(ts) {
                return AttentionStatus::NeedsInput;
            }
        }
    }
    attention
}

#[tauri::command]
pub fn get_session_summary(
    project_path: String,
    claude_session_id: String,
    agentdeck_status: String,
    tmux_session: Option<String>,
) -> SessionSummary {
    let Some(jsonl_path) = find_jsonl_path(&project_path, &claude_session_id) else {
        let attention = match agentdeck_status.as_str() {
            "running" => AttentionStatus::Running,
            // No JSONL file means no conversation yet — just the initial prompt
            "waiting" => AttentionStatus::Idle,
            "error" => AttentionStatus::Error,
            "idle" => AttentionStatus::Idle,
            _ => AttentionStatus::Unknown,
        };
        return SessionSummary {
            summary: None,
            attention: refine_with_tmux(attention, tmux_session.as_deref()),
            last_tool: None,
            last_text: None,
        };
    };

    // Read last 256KB of the file
    let lines = read_tail_lines(&jsonl_path, 256 * 1024);
    let attention = extract_attention(&lines, &agentdeck_status);

    SessionSummary {
        summary: extract_summary(&lines),
        attention: refine_with_tmux(attention, tmux_session.as_deref()),
        last_tool: extract_last_tool(&lines),
        last_text: extract_last_text(&lines),
    }
}
