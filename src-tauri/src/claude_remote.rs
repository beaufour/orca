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
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(vec![]);
    }

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Server returned {status}: {body}"));
    }

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
    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Server returned {status}: {body}"));
    }

    Ok(())
}

#[tauri::command]
pub async fn cr_get_status(server_url: String, token: String) -> Result<CrStatus, String> {
    let client = build_client(&token)?;
    let url = format!("{}/status", remote_common::normalize_url(&server_url));
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Server returned {status}: {body}"));
    }

    resp.json::<CrStatus>()
        .await
        .map_err(|e| format!("Failed to parse status: {e}"))
}

#[tauri::command]
pub async fn cr_delete_container(server_url: String, token: String) -> Result<(), String> {
    let client = build_client(&token)?;
    let url = remote_common::normalize_url(&server_url);
    let resp = client
        .delete(&url)
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Server returned {status}: {body}"));
    }

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
    remote_common::subscribe_sse(&app, &handles, &client, &url, "cr-event").await
}
