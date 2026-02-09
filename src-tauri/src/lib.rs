mod agentdeck;
mod claude_logs;
mod git;
mod models;
mod pty;
mod tmux;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
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
            agentdeck::rename_session,
            agentdeck::move_session,
            agentdeck::create_group,
            agentdeck::clear_session_worktree,
            claude_logs::get_session_summary,
            git::get_default_branch,
            git::list_worktrees,
            git::add_worktree,
            git::remove_worktree,
            git::merge_worktree,
            git::rebase_worktree,
            git::get_branch_diff,
            git::check_worktree_status,
            git::try_merge_branch,
            git::abort_merge,
            tmux::list_tmux_sessions,
            pty::attach_pty,
            pty::write_pty,
            pty::resize_pty,
            pty::close_pty,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
