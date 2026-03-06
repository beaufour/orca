use crate::remote_common;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use serde::{Deserialize, Serialize};
use std::time::Duration;

fn build_client(token: &str) -> Result<reqwest::Client, String> {
    let mut headers = HeaderMap::new();
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {token}"))
            .map_err(|e| format!("Invalid auth header: {e}"))?,
    );
    // Container cold starts can take up to 5 minutes
    remote_common::build_client(headers, Duration::from_secs(300))
}

/// Send a request and check for errors, logging the request and response.
async fn checked_response(
    resp: Result<reqwest::Response, reqwest::Error>,
    method: &str,
    url: &str,
) -> Result<reqwest::Response, String> {
    let resp = resp.map_err(|e| {
        log::error!("[claude-remote] {method} {url} failed: {e}");
        format!("{method} {url} failed: {e}")
    })?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        log::error!("[claude-remote] {method} {url} returned {status}: {body}");
        return Err(format!("{method} {url} returned {status}: {body}"));
    }
    log::info!("[claude-remote] {method} {url} -> {}", resp.status());
    Ok(resp)
}

// --- Types matching AgentAPI ---

/// Raw message from AgentAPI GET /messages
#[derive(Debug, Clone, Deserialize)]
struct ApiMessage {
    #[serde(default)]
    id: Option<i64>,
    role: String,
    content: String,
}

/// Message returned to frontend (matching RemoteMessage interface)
#[derive(Debug, Clone, Serialize)]
pub struct CrMessage {
    pub id: String,
    pub role: String,
    #[serde(rename = "type")]
    pub msg_type: String,
    pub content: String,
    pub tool_name: Option<String>,
    pub tool_id: Option<String>,
    pub timestamp: Option<i64>,
    pub session_id: String,
}

/// Status from AgentAPI GET /status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrStatus {
    pub status: String,
}

// --- Tauri Commands ---

#[tauri::command]
pub async fn cr_get_messages(server_url: String, token: String) -> Result<Vec<CrMessage>, String> {
    let client = build_client(&token)?;
    let url = format!("{}/messages", remote_common::normalize_url(&server_url));
    let resp = checked_response(client.get(&url).send().await, "GET", &url).await?;

    let body = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {e}"))?;

    // Handle empty body as empty conversation
    if body.is_empty() {
        return Ok(vec![]);
    }

    // Detect non-JSON responses (e.g. auth login pages, HTML error pages)
    let trimmed = body.trim_start();
    if trimmed.starts_with('<') {
        return Err("Server returned an HTML page instead of JSON. Check that the server URL and authentication are configured correctly.".to_string());
    }

    let json: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("Failed to parse messages: {e}"))?;

    // Support both {"messages": [...]} (AgentAPI/huma) and bare [...] formats
    let arr = if let Some(obj) = json.as_object() {
        obj.get("messages")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default()
    } else if let Some(arr) = json.as_array() {
        arr.clone()
    } else {
        return Ok(vec![]);
    };

    let api_messages: Vec<ApiMessage> = serde_json::from_value(serde_json::Value::Array(arr))
        .map_err(|e| format!("Failed to parse messages: {e}"))?;

    Ok(api_messages
        .into_iter()
        .enumerate()
        .map(|(i, m)| {
            // AgentAPI uses "agent" role; map to "assistant" for the frontend
            let role = if m.role == "agent" {
                "assistant".to_string()
            } else {
                m.role
            };
            CrMessage {
                id: format!("cr-{}", m.id.unwrap_or(i as i64)),
                role,
                msg_type: "text".to_string(),
                content: m.content,
                tool_name: None,
                tool_id: None,
                timestamp: None,
                session_id: String::new(),
            }
        })
        .collect())
}

#[tauri::command]
pub async fn cr_send_message(
    server_url: String,
    token: String,
    content: String,
) -> Result<(), String> {
    let client = build_client(&token)?;
    let url = format!("{}/message", remote_common::normalize_url(&server_url));
    let body = serde_json::json!({ "content": content, "type": "user" });
    checked_response(client.post(&url).json(&body).send().await, "POST", &url).await?;
    Ok(())
}

#[tauri::command]
pub async fn cr_get_status(server_url: String, token: String) -> Result<CrStatus, String> {
    let client = build_client(&token)?;
    let url = format!("{}/status", remote_common::normalize_url(&server_url));
    let resp = checked_response(client.get(&url).send().await, "GET", &url).await?;
    resp.json::<CrStatus>()
        .await
        .map_err(|e| format!("Failed to parse status: {e}"))
}

#[tauri::command]
pub async fn cr_setup_repo(
    server_url: String,
    token: String,
    repo_url: String,
    branch: String,
) -> Result<(), String> {
    let client = build_client(&token)?;
    let url = format!("{}/setup", remote_common::normalize_url(&server_url));
    let body = serde_json::json!({ "repo_url": repo_url, "branch": branch });
    checked_response(client.post(&url).json(&body).send().await, "POST", &url).await?;
    Ok(())
}

#[tauri::command]
pub async fn cr_delete_container(server_url: String, token: String) -> Result<(), String> {
    let client = build_client(&token)?;
    let url = remote_common::normalize_url(&server_url);
    checked_response(client.delete(&url).send().await, "DELETE", &url).await?;
    Ok(())
}

#[tauri::command]
pub async fn cr_subscribe_events(
    app: tauri::AppHandle,
    handles: tauri::State<'_, remote_common::SseHandles>,
    server_url: String,
    token: String,
) -> Result<(), String> {
    let client = build_client(&token)?;
    let url = format!("{}/events", remote_common::normalize_url(&server_url));
    log::info!("[claude-remote] Subscribing to SSE at {url}");
    remote_common::subscribe_sse(&app, &handles, &client, &url, "cr-event").await
}

// --- Exec endpoint (container command execution) ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecResult {
    pub stdout: String,
    pub stderr: String,
    #[serde(rename = "exitCode")]
    pub exit_code: i32,
}

/// Core HTTP POST to /exec endpoint. Reusable by both cr_exec and cr_get_branch_diff.
async fn exec_remote(
    server_url: &str,
    token: &str,
    command: &str,
    cwd: Option<&str>,
    timeout: Option<u64>,
) -> Result<ExecResult, String> {
    let mut headers = HeaderMap::new();
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {token}"))
            .map_err(|e| format!("Invalid auth header: {e}"))?,
    );

    // Use a longer HTTP timeout than the exec timeout to avoid racing
    let http_timeout = timeout.unwrap_or(30) + 5;
    let client = reqwest::Client::builder()
        .default_headers(headers)
        .timeout(Duration::from_secs(http_timeout))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let url = format!("{}/exec", remote_common::normalize_url(server_url));
    let mut body = serde_json::json!({ "command": command });
    if let Some(c) = cwd {
        body["cwd"] = serde_json::Value::String(c.to_string());
    }
    if let Some(t) = timeout {
        body["timeout"] = serde_json::Value::Number(serde_json::Number::from(t * 1000));
    }

    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Exec request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Exec endpoint returned {status}: {body}"));
    }

    resp.json::<ExecResult>()
        .await
        .map_err(|e| format!("Failed to parse exec result: {e}"))
}

#[tauri::command]
pub async fn cr_exec(
    server_url: String,
    token: String,
    command: String,
    cwd: Option<String>,
    timeout: Option<u64>,
) -> Result<ExecResult, String> {
    exec_remote(&server_url, &token, &command, cwd.as_deref(), timeout).await
}

#[tauri::command]
pub async fn cr_get_branch_diff(server_url: String, token: String) -> Result<String, String> {
    // Shell script that detects the default branch and runs git diff.
    // Same logic as the local get_default_branch_inner in git.rs.
    let script = r#"
cd /workspace
BASE=""
# Try symbolic-ref of origin/HEAD
REF=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null)
if [ -n "$REF" ]; then
  BASE="${REF#refs/remotes/origin/}"
fi
# Fallback: check local main/master
if [ -z "$BASE" ] && git rev-parse --verify main >/dev/null 2>&1; then
  BASE="main"
fi
if [ -z "$BASE" ] && git rev-parse --verify master >/dev/null 2>&1; then
  BASE="master"
fi
# Fallback: check remote tracking branches
if [ -z "$BASE" ] && git rev-parse --verify origin/main >/dev/null 2>&1; then
  BASE="origin/main"
fi
if [ -z "$BASE" ] && git rev-parse --verify origin/master >/dev/null 2>&1; then
  BASE="origin/master"
fi
if [ -z "$BASE" ]; then
  echo "Could not determine default branch" >&2
  exit 1
fi
git diff "$BASE"...HEAD
"#;

    let result = exec_remote(&server_url, &token, script, None, Some(30)).await?;
    if result.exit_code != 0 {
        return Err(format!(
            "git diff failed (exit {}): {}",
            result.exit_code,
            result.stderr.trim()
        ));
    }
    Ok(result.stdout)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exec_result_deserializes_camel_case() {
        let json = r#"{"stdout":"hello\n","stderr":"","exitCode":0}"#;
        let result: ExecResult = serde_json::from_str(json).unwrap();
        assert_eq!(result.stdout, "hello\n");
        assert_eq!(result.stderr, "");
        assert_eq!(result.exit_code, 0);
    }

    #[test]
    fn exec_result_nonzero_exit_code() {
        let json = r#"{"stdout":"","stderr":"not found\n","exitCode":127}"#;
        let result: ExecResult = serde_json::from_str(json).unwrap();
        assert_eq!(result.exit_code, 127);
        assert_eq!(result.stderr, "not found\n");
    }
}
