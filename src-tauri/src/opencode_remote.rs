use futures::StreamExt;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use serde::{Deserialize, Serialize};
use tauri::Emitter;

fn build_client(password: &str) -> Result<reqwest::Client, String> {
    let credentials = base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        format!("opencode:{password}"),
    );
    let mut headers = HeaderMap::new();
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Basic {credentials}"))
            .map_err(|e| format!("Invalid auth header: {e}"))?,
    );
    reqwest::Client::builder()
        .default_headers(headers)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))
}

fn normalize_url(server_url: &str) -> String {
    server_url.trim_end_matches('/').to_string()
}

// --- Types matching OpenCode REST API ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcSession {
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default, rename = "createdAt")]
    pub created_at: Option<i64>,
    #[serde(default, rename = "updatedAt")]
    pub updated_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcMessage {
    pub id: String,
    #[serde(default)]
    pub role: String,
    #[serde(default, rename = "type")]
    pub msg_type: String,
    #[serde(default)]
    pub content: serde_json::Value,
    #[serde(default, rename = "toolName")]
    pub tool_name: Option<String>,
    #[serde(default, rename = "toolId")]
    pub tool_id: Option<String>,
    #[serde(default)]
    pub timestamp: Option<i64>,
    #[serde(default, rename = "sessionId")]
    pub session_id: String,
}

// Note: OcPermission is returned by oc_respond_to_permission but parsed client-side
// from SSE events, so it uses serde Deserialize.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcCreateSessionRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_prompt: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcSendMessageRequest {
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcPermissionAction {
    pub action: String, // "allow" or "deny"
}

// --- SSE Event ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcSseEvent {
    pub event_type: String,
    pub data: serde_json::Value,
}

// --- Tauri Commands ---

#[tauri::command]
pub async fn oc_list_sessions(
    server_url: String,
    password: String,
) -> Result<Vec<OcSession>, String> {
    let client = build_client(&password)?;
    let url = format!("{}/session", normalize_url(&server_url));
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

    resp.json::<Vec<OcSession>>()
        .await
        .map_err(|e| format!("Failed to parse sessions: {e}"))
}

#[tauri::command]
pub async fn oc_create_session(
    server_url: String,
    password: String,
    title: Option<String>,
    initial_message: Option<String>,
) -> Result<OcSession, String> {
    let client = build_client(&password)?;
    let base = normalize_url(&server_url);

    let body = OcCreateSessionRequest {
        title,
        system_prompt: None,
    };

    let resp = client
        .post(format!("{base}/session"))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Server returned {status}: {body}"));
    }

    let session: OcSession = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse session: {e}"))?;

    // If an initial message was provided, send it
    if let Some(msg) = initial_message {
        let msg_body = OcSendMessageRequest { message: msg };
        let msg_resp = client
            .post(format!("{base}/session/{}/message", session.id))
            .json(&msg_body)
            .send()
            .await
            .map_err(|e| format!("Failed to send initial message: {e}"))?;

        if !msg_resp.status().is_success() {
            log::warn!(
                "Initial message send returned {}: {}",
                msg_resp.status(),
                msg_resp.text().await.unwrap_or_default()
            );
        }
    }

    Ok(session)
}

#[tauri::command]
pub async fn oc_delete_session(
    server_url: String,
    password: String,
    session_id: String,
) -> Result<(), String> {
    let client = build_client(&password)?;
    let url = format!("{}/session/{session_id}", normalize_url(&server_url));
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
pub async fn oc_send_message(
    server_url: String,
    password: String,
    session_id: String,
    message: String,
) -> Result<(), String> {
    let client = build_client(&password)?;
    let url = format!(
        "{}/session/{session_id}/message",
        normalize_url(&server_url)
    );
    let body = OcSendMessageRequest { message };
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
pub async fn oc_get_messages(
    server_url: String,
    password: String,
    session_id: String,
) -> Result<Vec<OcMessage>, String> {
    let client = build_client(&password)?;
    let url = format!(
        "{}/session/{session_id}/message",
        normalize_url(&server_url)
    );
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

    resp.json::<Vec<OcMessage>>()
        .await
        .map_err(|e| format!("Failed to parse messages: {e}"))
}

#[tauri::command]
pub async fn oc_respond_to_permission(
    server_url: String,
    password: String,
    session_id: String,
    permission_id: String,
    action: String,
) -> Result<(), String> {
    let client = build_client(&password)?;
    let url = format!(
        "{}/session/{session_id}/permissions/{permission_id}",
        normalize_url(&server_url)
    );
    let body = OcPermissionAction { action };
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
pub async fn oc_subscribe_events(
    app: tauri::AppHandle,
    server_url: String,
    password: String,
) -> Result<(), String> {
    let client = build_client(&password)?;
    let url = format!("{}/event", normalize_url(&server_url));

    let resp = client
        .get(&url)
        .header("Accept", "text/event-stream")
        .send()
        .await
        .map_err(|e| format!("SSE connection failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("SSE server returned {status}: {body}"));
    }

    // Spawn a background task to read the SSE stream
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut stream = resp.bytes_stream();
        let mut buffer = String::new();

        while let Some(chunk) = stream.next().await {
            match chunk {
                Ok(bytes) => {
                    buffer.push_str(&String::from_utf8_lossy(&bytes));

                    // Parse SSE events from buffer
                    while let Some(end) = buffer.find("\n\n") {
                        let event_text = buffer[..end].to_string();
                        buffer = buffer[end + 2..].to_string();

                        if let Some(event) = parse_sse_event(&event_text) {
                            let _ = app_handle.emit("oc-event", &event);
                        }
                    }
                }
                Err(e) => {
                    log::error!("SSE stream error: {e}");
                    break;
                }
            }
        }

        log::info!("SSE stream ended for {}", normalize_url(&server_url));
    });

    Ok(())
}

fn parse_sse_event(text: &str) -> Option<OcSseEvent> {
    let mut event_type = String::from("message");
    let mut data_lines = Vec::new();

    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("event:") {
            event_type = rest.trim().to_string();
        } else if let Some(rest) = line.strip_prefix("data:") {
            data_lines.push(rest.trim().to_string());
        }
    }

    if data_lines.is_empty() {
        return None;
    }

    let data_str = data_lines.join("\n");
    let data: serde_json::Value = match serde_json::from_str(&data_str) {
        Ok(v) => v,
        Err(_) => serde_json::Value::String(data_str),
    };

    Some(OcSseEvent { event_type, data })
}
