mod agentdeck;
mod claude_logs;
mod git;
mod models;
mod pty;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(pty::PtyManager::default())
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
            agentdeck::get_attention_counts,
            agentdeck::get_attention_sessions,
            agentdeck::create_session,
            agentdeck::remove_session,
            agentdeck::restart_session,
            agentdeck::update_session_worktree,
            claude_logs::get_session_summary,
            git::list_worktrees,
            git::add_worktree,
            git::remove_worktree,
            git::merge_worktree,
            git::rebase_worktree,
            pty::attach_pty,
            pty::write_pty,
            pty::resize_pty,
            pty::close_pty,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
