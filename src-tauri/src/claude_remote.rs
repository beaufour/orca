use futures::StreamExt;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use serde::{Deserialize, Serialize};
use tauri::Emitter;

fn build_client(token: &str) -> Result<reqwest::Client, String> {
    let mut headers = HeaderMap::new();
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {token}"))
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

/// SSE event emitted to frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrSseEvent {
    pub event_type: String,
    pub data: serde_json::Value,
}

// --- Tauri Commands ---

#[tauri::command]
pub async fn cr_get_messages(server_url: String, token: String) -> Result<Vec<CrMessage>, String> {
    let client = build_client(&token)?;
    let url = format!("{}/messages", normalize_url(&server_url));
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
    let url = format!("{}/message", normalize_url(&server_url));
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
    let url = format!("{}/status", normalize_url(&server_url));
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
    let url = format!("{}/events", normalize_url(&server_url));

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

    let app_handle = app.clone();
    let url_for_log = normalize_url(&server_url);
    tauri::async_runtime::spawn(async move {
        let mut stream = resp.bytes_stream();
        let mut buffer = String::new();

        while let Some(chunk) = stream.next().await {
            match chunk {
                Ok(bytes) => {
                    buffer.push_str(&String::from_utf8_lossy(&bytes));

                    while let Some(end) = buffer.find("\n\n") {
                        let event_text = buffer[..end].to_string();
                        buffer = buffer[end + 2..].to_string();

                        if let Some(event) = parse_sse_event(&event_text) {
                            let _ = app_handle.emit("cr-event", &event);
                        }
                    }
                }
                Err(e) => {
                    log::error!("SSE stream error: {e}");
                    break;
                }
            }
        }

        log::info!("SSE stream ended for {url_for_log}");
    });

    Ok(())
}

fn parse_sse_event(text: &str) -> Option<CrSseEvent> {
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

    Some(CrSseEvent { event_type, data })
}
