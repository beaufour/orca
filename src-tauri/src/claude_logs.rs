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
    let candidate = base.join(&encoded).join(format!("{}.jsonl", claude_session_id));
    if candidate.exists() {
        return Some(candidate);
    }

    // Try subdirectories that start with the encoded path (for worktrees)
    if let Ok(entries) = std::fs::read_dir(&base) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with(&encoded) {
                let candidate = entry.path().join(format!("{}.jsonl", claude_session_id));
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
    let file = match File::open(path) {
        Ok(f) => f,
        Err(_) => return vec![],
    };

    let metadata = match file.metadata() {
        Ok(m) => m,
        Err(_) => return vec![],
    };

    let file_size = metadata.len();
    let seek_pos = if file_size > max_bytes {
        file_size - max_bytes
    } else {
        0
    };

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
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
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
    // Use agent-deck status as primary signal
    match agentdeck_status {
        "running" => return AttentionStatus::Running,
        "waiting" => return AttentionStatus::NeedsInput,
        _ => {}
    }

    // For idle/error, refine using JSONL
    let relevant: Vec<&serde_json::Value> = lines
        .iter()
        .filter(|l| {
            let t = l.get("type").and_then(|v| v.as_str()).unwrap_or("");
            t == "assistant" || t == "user"
        })
        .collect();

    if relevant.is_empty() {
        return AttentionStatus::Unknown;
    }

    let last = relevant.last().unwrap();
    let msg = last.get("message").unwrap_or(last);
    let role = msg.get("role").and_then(|v| v.as_str()).unwrap_or("");
    let content = msg.get("content").and_then(|v| v.as_array());

    if role == "assistant" {
        if let Some(content_arr) = content {
            // Check for AskUserQuestion tool use
            for item in content_arr {
                if item.get("type").and_then(|v| v.as_str()) == Some("tool_use") {
                    let name = item.get("name").and_then(|v| v.as_str()).unwrap_or("");
                    if name == "AskUserQuestion" || name == "ExitPlanMode" {
                        return AttentionStatus::NeedsInput;
                    }
                }
            }
        }
    }

    if role == "user" {
        if let Some(content_arr) = content {
            // Check for error in tool results
            for item in content_arr {
                if item.get("type").and_then(|v| v.as_str()) == Some("tool_result") {
                    if item.get("is_error").and_then(|v| v.as_bool()) == Some(true) {
                        return AttentionStatus::Error;
                    }
                }
            }
        }
    }

    // Check staleness based on timestamp
    if let Some(ts) = lines.last().and_then(|l| l.get("timestamp").and_then(|v| v.as_f64())) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs_f64();
        if now - ts > 3600.0 {
            return AttentionStatus::Stale;
        }
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

#[tauri::command]
pub fn get_session_summary(
    project_path: String,
    claude_session_id: String,
    agentdeck_status: String,
) -> SessionSummary {
    let jsonl_path = match find_jsonl_path(&project_path, &claude_session_id) {
        Some(p) => p,
        None => {
            return SessionSummary {
                summary: None,
                attention: match agentdeck_status.as_str() {
                    "running" => AttentionStatus::Running,
                    "waiting" => AttentionStatus::NeedsInput,
                    "error" => AttentionStatus::Error,
                    "idle" => AttentionStatus::Idle,
                    _ => AttentionStatus::Unknown,
                },
                last_tool: None,
                last_text: None,
            };
        }
    };

    // Read last 256KB of the file
    let lines = read_tail_lines(&jsonl_path, 256 * 1024);

    SessionSummary {
        summary: extract_summary(&lines),
        attention: extract_attention(&lines, &agentdeck_status),
        last_tool: extract_last_tool(&lines),
        last_text: extract_last_text(&lines),
    }
}
