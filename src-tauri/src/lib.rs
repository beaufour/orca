mod agentdeck;
mod claude_logs;
mod git;
mod models;
mod tmux;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            agentdeck::get_groups,
            agentdeck::get_sessions,
            agentdeck::create_session,
            claude_logs::get_session_summary,
            git::list_worktrees,
            git::add_worktree,
            git::remove_worktree,
            git::merge_worktree,
            git::rebase_worktree,
            tmux::capture_pane,
            tmux::send_keys,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
