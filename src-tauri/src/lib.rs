mod agentdeck;
mod claude_logs;
mod command;
mod git;
mod github;
mod models;
mod pty;
mod tmux;

use crate::command::new_command;
use std::io::{BufRead, BufReader};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, Manager};

#[tauri::command]
fn read_app_log(app: tauri::AppHandle, tail_lines: Option<usize>) -> Result<String, String> {
    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("Failed to get log dir: {e}"))?;
    let log_path = log_dir.join("orca.log");
    let file =
        std::fs::File::open(&log_path).map_err(|e| format!("Failed to open log file: {e}"))?;
    let reader = BufReader::new(file);
    let lines: Vec<String> = reader
        .lines()
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;
    let n = tail_lines.unwrap_or(1000);
    let start = lines.len().saturating_sub(n);
    Ok(lines[start..].join("\n"))
}

#[tauri::command]
fn open_in_terminal(path: String) -> Result<(), String> {
    let escaped = path.replace('\\', "\\\\").replace('"', "\\\"");
    let script = format!(
        r#"tell application "iTerm2"
            activate
            set newWindow to (create window with default profile)
            tell current session of newWindow
                write text "cd \"{escaped}\""
            end tell
        end tell"#
    );
    new_command("osascript")
        .args(["-e", &script])
        .spawn()
        .map_err(|e| format!("Failed to open iTerm: {e}"))?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    command::init_path();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(pty::PtyManager::default())
        .setup(|app| {
            let handle = app.handle();

            handle.plugin(
                tauri_plugin_log::Builder::default()
                    .level(if cfg!(debug_assertions) {
                        log::LevelFilter::Info
                    } else {
                        log::LevelFilter::Error
                    })
                    .build(),
            )?;

            // Native app menu
            let about_item =
                MenuItem::with_id(handle, "about_orca", "About Orca", true, None::<&str>)?;

            let app_submenu = Submenu::with_items(
                handle,
                "Orca",
                true,
                &[
                    &about_item,
                    &PredefinedMenuItem::separator(handle)?,
                    &PredefinedMenuItem::hide(handle, None)?,
                    &PredefinedMenuItem::hide_others(handle, None)?,
                    &PredefinedMenuItem::show_all(handle, None)?,
                    &PredefinedMenuItem::separator(handle)?,
                    &PredefinedMenuItem::quit(handle, None)?,
                ],
            )?;

            let edit_submenu = Submenu::with_items(
                handle,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(handle, None)?,
                    &PredefinedMenuItem::redo(handle, None)?,
                    &PredefinedMenuItem::separator(handle)?,
                    &PredefinedMenuItem::cut(handle, None)?,
                    &PredefinedMenuItem::copy(handle, None)?,
                    &PredefinedMenuItem::paste(handle, None)?,
                    &PredefinedMenuItem::select_all(handle, None)?,
                ],
            )?;

            let window_submenu = Submenu::with_items(
                handle,
                "Window",
                true,
                &[
                    &PredefinedMenuItem::minimize(handle, None)?,
                    &PredefinedMenuItem::maximize(handle, None)?,
                    &PredefinedMenuItem::separator(handle)?,
                    &PredefinedMenuItem::close_window(handle, None)?,
                ],
            )?;

            let help_item =
                MenuItem::with_id(handle, "help_github", "Orca Help", true, None::<&str>)?;
            let help_submenu = Submenu::with_items(handle, "Help", true, &[&help_item])?;

            let menu = Menu::with_items(
                handle,
                &[&app_submenu, &edit_submenu, &window_submenu, &help_submenu],
            )?;
            app.set_menu(menu)?;

            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id() == "about_orca" {
                let _ = app.emit("show-about", ());
            } else if event.id() == "help_github" {
                let _ =
                    tauri_plugin_opener::open_url("https://github.com/beaufour/orca", None::<&str>);
            }
        })
        .invoke_handler(tauri::generate_handler![
            agentdeck::check_agent_deck_version,
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
            agentdeck::update_group_settings,
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
            git::clone_bare_worktree_repo,
            git::init_bare_repo,
            tmux::list_tmux_sessions,
            tmux::paste_to_tmux_pane,
            tmux::scroll_tmux_pane,
            github::list_issues,
            github::get_issue,
            github::create_issue,
            github::update_issue,
            github::close_issue,
            github::assign_issue,
            pty::attach_pty,
            pty::write_pty,
            pty::resize_pty,
            pty::close_pty,
            read_app_log,
            open_in_terminal,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
