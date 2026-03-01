use crate::remote_common;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use serde::{Deserialize, Serialize};

fn build_client(token: &str) -> Result<reqwest::Client, String> {
    let mut headers = HeaderMap::new();
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {token}"))
            .map_err(|e| format!("Invalid auth header: {e}"))?,
    );
    remote_common::build_client(headers)
}

// --- Types matching AgentAPI ---

/// Raw message from AgentAPI GET /messages
#[derive(Debug, Clone, Deserialize)]
struct ApiMessage {
    role: String,
    content: String,
    #[serde(default)]
    _timestamp: Option<String>,
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

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Server returned {status}: {body}"));
    }

    let api_messages: Vec<ApiMessage> = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse messages: {e}"))?;

    Ok(api_messages
        .into_iter()
        .enumerate()
        .map(|(i, m)| CrMessage {
            id: format!("cr-{i}"),
            role: m.role,
            msg_type: "text".to_string(),
            content: m.content,
            tool_name: None,
            tool_id: None,
            timestamp: None,
            session_id: String::new(),
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
    let body = serde_json::json!({ "content": content });
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
pub async fn cr_subscribe_events(
    app: tauri::AppHandle,
    server_url: String,
    token: String,
) -> Result<(), String> {
    let client = build_client(&token)?;
    let url = format!("{}/events", remote_common::normalize_url(&server_url));
    remote_common::subscribe_sse(&app, &client, &url, "cr-event").await
}
