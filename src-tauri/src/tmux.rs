use std::process::Command;

#[tauri::command]
pub fn capture_pane(tmux_session: String) -> Result<String, String> {
    if tmux_session.is_empty() {
        return Err("No tmux session specified".to_string());
    }

    let output = Command::new("tmux")
        .args(["capture-pane", "-t", &tmux_session, "-p", "-S", "-200"])
        .output()
        .map_err(|e| format!("Failed to run tmux: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("tmux capture-pane failed: {}", stderr.trim()));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
pub fn send_keys(tmux_session: String, keys: String) -> Result<(), String> {
    if tmux_session.is_empty() {
        return Err("No tmux session specified".to_string());
    }

    let output = Command::new("tmux")
        .args(["send-keys", "-t", &tmux_session, &keys, "Enter"])
        .output()
        .map_err(|e| format!("Failed to run tmux: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("tmux send-keys failed: {}", stderr.trim()));
    }

    Ok(())
}
