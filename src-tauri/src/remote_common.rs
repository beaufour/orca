use futures::StreamExt;
use reqwest::header::HeaderMap;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::Emitter;

/// SSE event emitted to frontend (shared by all remote backends).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SseEvent {
    pub event_type: String,
    pub data: serde_json::Value,
}

/// Strip trailing slashes from a server URL.
pub fn normalize_url(server_url: &str) -> String {
    server_url.trim_end_matches('/').to_string()
}

/// Build a reqwest client with the given default headers and a 30-second timeout.
pub fn build_client(headers: HeaderMap) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .default_headers(headers)
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))
}

/// Parse a single SSE event block (text between double newlines) into an SseEvent.
pub fn parse_sse_event(text: &str) -> Option<SseEvent> {
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

    Some(SseEvent { event_type, data })
}

/// Connect to an SSE endpoint and emit parsed events to the Tauri frontend.
///
/// `event_name` is the Tauri event name (e.g. "cr-event" or "oc-event").
pub async fn subscribe_sse(
    app: &tauri::AppHandle,
    client: &reqwest::Client,
    url: &str,
    event_name: &str,
) -> Result<(), String> {
    let resp = client
        .get(url)
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
    let event_name = event_name.to_string();
    let url_for_log = url.to_string();
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
                            let _ = app_handle.emit(&event_name, &event);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_event_with_type_and_json_data() {
        let text = "event: status_update\ndata: {\"status\":\"running\"}";
        let event = parse_sse_event(text).unwrap();
        assert_eq!(event.event_type, "status_update");
        assert_eq!(event.data["status"], "running");
    }

    #[test]
    fn parse_event_default_type_is_message() {
        let text = "data: {\"hello\":\"world\"}";
        let event = parse_sse_event(text).unwrap();
        assert_eq!(event.event_type, "message");
        assert_eq!(event.data["hello"], "world");
    }

    #[test]
    fn parse_event_multiline_data() {
        let text = "data: {\"a\":1,\ndata: \"b\":2}";
        let event = parse_sse_event(text).unwrap();
        // Multi-line data joined, parsed as JSON
        assert_eq!(event.data["a"], 1);
        assert_eq!(event.data["b"], 2);
    }

    #[test]
    fn parse_event_non_json_data_becomes_string() {
        let text = "data: just plain text";
        let event = parse_sse_event(text).unwrap();
        assert_eq!(
            event.data,
            serde_json::Value::String("just plain text".to_string())
        );
    }

    #[test]
    fn parse_event_empty_data_returns_none() {
        let text = "event: heartbeat";
        assert!(parse_sse_event(text).is_none());
    }

    #[test]
    fn parse_event_no_lines_returns_none() {
        assert!(parse_sse_event("").is_none());
    }

    #[test]
    fn normalize_url_strips_trailing_slashes() {
        assert_eq!(
            normalize_url("http://localhost:3000/"),
            "http://localhost:3000"
        );
        assert_eq!(
            normalize_url("http://localhost:3000"),
            "http://localhost:3000"
        );
        assert_eq!(normalize_url("http://example.com///"), "http://example.com");
    }
}
