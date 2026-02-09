use std::process::Command;
use tauri::command;

/// Send raw bytes to a tmux pane via `tmux send-keys -H`.
///
/// This bypasses tmux's terminal input parser entirely, injecting bytes
/// directly into the target pane. Used for key sequences that xterm.js
/// can't send through the normal PTY path (e.g. CSI u modified keys
/// like Shift+Enter that tmux may not forward from an xterm-256color
/// terminal).
#[command]
pub fn send_tmux_keys(tmux_session: String, hex_bytes: Vec<String>) -> Result<(), String> {
    let mut args = vec![
        "send-keys".to_string(),
        "-t".to_string(),
        tmux_session,
        "-H".to_string(),
    ];
    args.extend(hex_bytes);

    let output = Command::new("tmux")
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to run tmux send-keys: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("tmux send-keys failed: {}", stderr.trim()));
    }

    Ok(())
}

/// Check if a tmux session is showing a Claude Code permission prompt
/// ("Do you want to proceed?").  Captures the last 20 lines of the pane
/// and looks for the distinctive prompt text.
pub fn is_waiting_for_input(tmux_session: &str) -> bool {
    let output = match Command::new("tmux")
        .args(["capture-pane", "-t", tmux_session, "-p", "-l", "20"])
        .output()
    {
        Ok(o) if o.status.success() => o,
        _ => return false,
    };

    let text = String::from_utf8_lossy(&output.stdout);
    text.contains("Do you want to proceed?")
}

#[tauri::command]
pub fn list_tmux_sessions() -> Result<Vec<String>, String> {
    log::debug!("tmux list-sessions -F #{{session_name}}");
    let output = Command::new("tmux")
        .args(["list-sessions", "-F", "#{session_name}"])
        .output()
        .map_err(|e| format!("Failed to run tmux: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // "no server running" means no tmux sessions exist — return empty
        if stderr.contains("no server running") || stderr.contains("no sessions") {
            log::debug!("tmux: no server running or no sessions");
            return Ok(Vec::new());
        }
        log::error!(
            "tmux list-sessions failed (exit {}): {}",
            output.status,
            stderr.trim()
        );
        return Err(format!("tmux list-sessions failed: {}", stderr.trim()));
    }

    let sessions: Vec<String> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(std::string::ToString::to_string)
        .collect();

    log::debug!("tmux list-sessions: {} sessions found", sessions.len());
    Ok(sessions)
}
