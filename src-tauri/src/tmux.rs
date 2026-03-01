use crate::command::new_command;
use tauri::command;

/// Paste text into a tmux pane using bracketed paste mode.
///
/// Loads text into a temporary tmux buffer, then pastes it with `-p`
/// (bracketed paste). The application in the pane receives the text
/// wrapped in bracketed paste markers and inserts it literally.
///
/// When `submit` is true, sends Enter after a brief pause to submit
/// the pasted text (e.g. to a Claude Code prompt).
#[command]
pub fn paste_to_tmux_pane(
    tmux_session: String,
    text: String,
    submit: Option<bool>,
) -> Result<(), String> {
    log::info!(
        "paste_to_tmux_pane: tmux_session={tmux_session}, text_len={}, submit={:?}",
        text.len(),
        submit
    );

    if submit.unwrap_or(false) {
        paste_and_submit(&tmux_session, &text)
    } else {
        bracketed_paste(&tmux_session, &text)
    }
}

/// Scroll a tmux pane up or down by entering copy mode.
///
/// Uses `-e` flag so copy mode auto-exits when scrolled back to the bottom.
#[command]
pub fn scroll_tmux_pane(tmux_session: String, direction: String, lines: u32) -> Result<(), String> {
    log::debug!(
        "scroll_tmux_pane: tmux_session={tmux_session}, direction={direction}, lines={lines}"
    );
    if direction != "up" && direction != "down" {
        return Err(format!(
            "Invalid scroll direction: '{direction}' (expected 'up' or 'down')"
        ));
    }
    if direction == "up" {
        // Enter copy mode with auto-exit at bottom (-e)
        if let Err(e) = new_command("tmux")
            .args(["copy-mode", "-t", &tmux_session, "-e"])
            .output()
        {
            log::warn!("tmux copy-mode failed for '{tmux_session}': {e}");
        }
    }

    let scroll_cmd = if direction == "up" {
        "scroll-up"
    } else {
        "scroll-down"
    };
    if let Err(e) = new_command("tmux")
        .args([
            "send-keys",
            "-t",
            &tmux_session,
            "-X",
            "-N",
            &lines.to_string(),
            scroll_cmd,
        ])
        .output()
    {
        log::warn!("tmux scroll ({scroll_cmd}) failed for '{tmux_session}': {e}");
    }

    Ok(())
}

/// Check if a tmux session exists (is alive).
pub fn is_tmux_session_alive(tmux_session: &str) -> bool {
    let ok = new_command("tmux")
        .args(["has-session", "-t", tmux_session])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    log::debug!("is_tmux_session_alive: tmux_session={tmux_session}, result={ok}");
    ok
}

/// Check if a tmux session is showing a Claude Code input prompt.
/// Captures the last 20 lines of the pane and looks for permission prompts
/// ("Do you want to proceed?") or Claude Code's general input prompt (❯ / >).
pub fn is_waiting_for_input(tmux_session: &str) -> bool {
    let output = match new_command("tmux")
        .args(["capture-pane", "-t", tmux_session, "-p", "-l", "20"])
        .output()
    {
        Ok(o) if o.status.success() => o,
        _ => return false,
    };

    let text = String::from_utf8_lossy(&output.stdout);
    let waiting = pane_shows_input_prompt(&text);

    log::debug!("is_waiting_for_input: tmux_session={tmux_session}, result={waiting}");
    waiting
}

/// Paste text into a tmux pane using bracketed paste mode.
///
/// Uses `tmux set-buffer` + `paste-buffer -p` so the text arrives as a
/// single bracketed paste event rather than individual keystrokes.
fn bracketed_paste(tmux_session: &str, text: &str) -> Result<(), String> {
    let status = new_command("tmux")
        .args(["set-buffer", "-b", "_orca", "--", text])
        .status()
        .map_err(|e| format!("Failed to set tmux buffer: {e}"))?;

    if !status.success() {
        return Err("tmux set-buffer failed".to_string());
    }

    let output = new_command("tmux")
        .args([
            "paste-buffer",
            "-t",
            tmux_session,
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

/// Paste text into a tmux pane using bracketed paste, then send Enter to submit.
///
/// Uses `tmux set-buffer` + `paste-buffer -p` for reliable delivery, then
/// sends a literal CR to submit. This is the canonical way to send a prompt
/// to a Claude Code (or similar) session.
pub(crate) fn paste_and_submit(tmux_session: &str, text: &str) -> Result<(), String> {
    log::info!(
        "paste_and_submit: tmux_session={tmux_session}, text_len={}",
        text.len(),
    );

    bracketed_paste(tmux_session, text)?;

    // Brief pause so the TUI processes the pasted text before submitting
    std::thread::sleep(std::time::Duration::from_millis(200));

    let enter_output = new_command("tmux")
        .args(["send-keys", "-l", "-t", tmux_session, "\r"])
        .output()
        .map_err(|e| format!("Failed to send Enter via tmux: {e}"))?;

    if !enter_output.status.success() {
        let stderr = String::from_utf8_lossy(&enter_output.stderr);
        return Err(format!("tmux send-keys (Enter) failed: {}", stderr.trim()));
    }

    Ok(())
}

/// Check if pane text contains a Claude Code input prompt.
///
/// Detects two patterns:
/// 1. Permission prompt: text contains "Do you want to proceed?"
/// 2. General input prompt: last non-empty line is or ends with `❯` or `>`
pub(crate) fn pane_shows_input_prompt(text: &str) -> bool {
    if text.contains("Do you want to proceed?") {
        return true;
    }

    text.lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .map(|line| {
            let trimmed = line.trim();
            trimmed == "❯" || trimmed == ">" || trimmed.ends_with(" ❯") || trimmed.ends_with(" >")
        })
        .unwrap_or(false)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompt_permission_prompt() {
        let text = "Some output\nDo you want to proceed?\n(Y)es / (N)o";
        assert!(pane_shows_input_prompt(text));
    }

    #[test]
    fn prompt_bare_arrow() {
        assert!(pane_shows_input_prompt("❯"));
        assert!(pane_shows_input_prompt(">"));
    }

    #[test]
    fn prompt_arrow_with_prefix() {
        assert!(pane_shows_input_prompt("claude ❯"));
        assert!(pane_shows_input_prompt("project >"));
    }

    #[test]
    fn prompt_arrow_with_trailing_whitespace() {
        assert!(pane_shows_input_prompt("❯  \n\n"));
        assert!(pane_shows_input_prompt("some output\n  ❯  \n  \n"));
    }

    #[test]
    fn prompt_not_detected_for_regular_output() {
        assert!(!pane_shows_input_prompt("Building project..."));
        assert!(!pane_shows_input_prompt("test result: ok. 5 passed"));
    }

    #[test]
    fn prompt_empty_text() {
        assert!(!pane_shows_input_prompt(""));
        assert!(!pane_shows_input_prompt("  \n  \n  "));
    }

    #[test]
    fn prompt_arrow_not_at_end_of_line() {
        // ❯ in the middle of a line should not match
        assert!(!pane_shows_input_prompt("foo ❯ bar"));
        assert!(!pane_shows_input_prompt("value > threshold"));
    }
}
