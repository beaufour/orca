mod agentdeck;
mod claude_logs;
mod command;
mod git;
mod github;
mod models;
mod opencode_remote;
mod orca_db;
mod pty;
mod tmux;

use crate::command::new_command;
use std::io::{BufRead, BufReader};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

/// Placeholder DSN — replace with your actual Sentry project DSN.
const SENTRY_DSN: &str =
    "https://784e5e4951e78d437d264568ae36dd53@o1366758.ingest.us.sentry.io/4510964361658368";

/// Wrapper so we can store the flag as Tauri managed state.
pub struct SentryEnabled(Arc<AtomicBool>);

/// Read the analytics_enabled flag directly from the Orca SQLite DB
/// *before* Tauri's path resolver is available.
fn read_analytics_enabled_early() -> bool {
    let Some(data_dir) = dirs::data_dir() else {
        return false;
    };
    let db_path = data_dir.join("dk.beaufour.orca").join("orca.db");
    let Ok(conn) =
        rusqlite::Connection::open_with_flags(&db_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
    else {
        return false;
    };
    conn.query_row(
        "SELECT value FROM metadata WHERE key = 'analytics_enabled'",
        [],
        |row| row.get::<_, String>(0),
    )
    .map(|v| v == "true")
    .unwrap_or(false)
}

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

#[tauri::command]
fn get_analytics_enabled(orca_db: tauri::State<'_, orca_db::OrcaDb>) -> Result<bool, String> {
    orca_db.get_analytics_enabled()
}

#[tauri::command]
fn set_analytics_enabled(
    orca_db: tauri::State<'_, orca_db::OrcaDb>,
    sentry_flag: tauri::State<'_, SentryEnabled>,
    enabled: bool,
) -> Result<(), String> {
    sentry_flag.0.store(enabled, Ordering::Relaxed);
    orca_db.set_analytics_enabled(enabled)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    command::init_path();

    // Initialize Sentry before the Tauri builder so it captures panics from the start.
    let analytics_enabled = read_analytics_enabled_early();
    let sentry_flag = Arc::new(AtomicBool::new(analytics_enabled));
    let flag_for_hook = sentry_flag.clone();

    let sentry_client = sentry::init((
        SENTRY_DSN,
        sentry::ClientOptions {
            release: sentry::release_name!(),
            environment: Some(
                if cfg!(debug_assertions) {
                    "development"
                } else {
                    "production"
                }
                .into(),
            ),
            before_send: Some(Arc::new(move |event| {
                if flag_for_hook.load(Ordering::Relaxed) {
                    Some(event)
                } else {
                    None
                }
            })),
            ..Default::default()
        },
    ));

    let _minidump = tauri_plugin_sentry::minidump::init(&sentry_client);

    tauri::Builder::default()
        .plugin(tauri_plugin_sentry::init(&sentry_client))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(SentryEnabled(sentry_flag))
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

            // Create the main window programmatically so we can add on_navigation
            // to intercept external URLs and open them in the system browser
            WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("Orca")
                .inner_size(1200.0, 800.0)
                .min_inner_size(640.0, 400.0)
                .resizable(true)
                .center()
                .on_navigation(|url| {
                    // Allow internal navigation (Tauri assets and dev server)
                    if url.scheme() == "tauri"
                        || url.scheme() == "asset"
                        || url.host_str() == Some("localhost")
                    {
                        return true;
                    }
                    // External URL: open in system browser, prevent webview navigation
                    let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
                    false
                })
                .build()?;

            let data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("Failed to get app data dir: {e}"))?;
            let orca_db = orca_db::OrcaDb::init(&data_dir)
                .map_err(|e| format!("Failed to init Orca DB: {e}"))?;
            app.manage(orca_db);

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
            agentdeck::remove_session_background,
            agentdeck::restart_session,
            agentdeck::update_session_worktree,
            agentdeck::rename_session,
            agentdeck::move_session,
            agentdeck::create_group,
            agentdeck::delete_group,
            agentdeck::clear_session_worktree,
            agentdeck::update_group_settings,
            agentdeck::get_server_password,
            agentdeck::store_session_pr_info,
            agentdeck::get_dismissed_ids,
            agentdeck::set_dismissed,
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
            git::push_branch,
            git::force_push_branch,
            git::rebase_branch,
            git::abort_rebase,
            git::update_main_branch,
            git::list_components,
            tmux::list_tmux_sessions,
            tmux::paste_to_tmux_pane,
            tmux::scroll_tmux_pane,
            github::list_issues,
            github::get_issue,
            github::create_issue,
            github::update_issue,
            github::close_issue,
            github::assign_issue,
            github::unassign_issue,
            github::create_pr,
            github::check_pr_status,
            github::get_github_username,
            pty::attach_pty,
            pty::write_pty,
            pty::resize_pty,
            pty::close_pty,
            command::check_prerequisites,
            opencode_remote::oc_list_sessions,
            opencode_remote::oc_create_session,
            opencode_remote::oc_delete_session,
            opencode_remote::oc_send_message,
            opencode_remote::oc_get_messages,
            opencode_remote::oc_respond_to_permission,
            opencode_remote::oc_subscribe_events,
            read_app_log,
            open_in_terminal,
            get_analytics_enabled,
            set_analytics_enabled,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
