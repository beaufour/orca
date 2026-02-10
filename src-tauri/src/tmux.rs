use crate::command::new_command;
use tauri::command;

/// Paste text into a tmux pane using bracketed paste mode.
///
/// Loads text into a temporary tmux buffer, then pastes it with `-p`
/// (bracketed paste). The application in the pane receives the text
/// wrapped in bracketed paste markers and inserts it literally.
/// Used for Shift+Enter (paste a newline without submitting).
#[command]
pub fn paste_to_tmux_pane(tmux_session: String, text: String) -> Result<(), String> {
    let status = new_command("tmux")
        .args(["set-buffer", "-b", "_orca", "--", &text])
        .status()
        .map_err(|e| format!("Failed to set tmux buffer: {e}"))?;

    if !status.success() {
        return Err("tmux set-buffer failed".to_string());
    }

    let output = new_command("tmux")
        .args([
            "paste-buffer",
            "-t",
            &tmux_session,
            "-b",
            "_orca",
            "-p",
            "-d",
        ])
        .output()
        .map_err(|e| format!("Failed to paste tmux buffer: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("tmux paste-buffer failed: {}", stderr.trim()));
    }

    Ok(())
}

/// Scroll a tmux pane up or down by entering copy mode.
///
/// Uses `-e` flag so copy mode auto-exits when scrolled back to the bottom.
#[command]
pub fn scroll_tmux_pane(tmux_session: String, direction: String, lines: u32) -> Result<(), String> {
    if direction == "up" {
        // Enter copy mode with auto-exit at bottom (-e)
        let _ = new_command("tmux")
            .args(["copy-mode", "-t", &tmux_session, "-e"])
            .output();
    }

    let scroll_cmd = if direction == "up" {
        "scroll-up"
    } else {
        "scroll-down"
    };
    let _ = new_command("tmux")
        .args([
            "send-keys",
            "-t",
            &tmux_session,
            "-X",
            "-N",
            &lines.to_string(),
            scroll_cmd,
        ])
        .output();

    Ok(())
}

/// Check if a tmux session is showing a Claude Code permission prompt
/// ("Do you want to proceed?").  Captures the last 20 lines of the pane
/// and looks for the distinctive prompt text.
pub fn is_waiting_for_input(tmux_session: &str) -> bool {
    let output = match new_command("tmux")
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
    let output = new_command("tmux")
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
