use rusqlite::Connection;
use std::path::PathBuf;

use crate::models::{Group, Session};

fn db_path() -> PathBuf {
    let home = dirs::home_dir().expect("could not find home directory");
    home.join(".agent-deck/profiles/default/state.db")
}

#[tauri::command]
pub fn get_groups() -> Result<Vec<Group>, String> {
    let path = db_path();
    let conn = Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Failed to open agent-deck DB at {}: {}", path.display(), e))?;

    let mut stmt = conn
        .prepare("SELECT path, name, expanded, sort_order, default_path FROM groups ORDER BY sort_order")
        .map_err(|e| e.to_string())?;

    let groups = stmt
        .query_map([], |row| {
            Ok(Group {
                path: row.get(0)?,
                name: row.get(1)?,
                expanded: row.get::<_, i32>(2)? != 0,
                sort_order: row.get(3)?,
                default_path: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(groups)
}

#[tauri::command]
pub fn get_sessions(group_path: Option<String>) -> Result<Vec<Session>, String> {
    let path = db_path();
    let conn = Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Failed to open agent-deck DB at {}: {}", path.display(), e))?;

    let sessions = match group_path {
        Some(gp) => query_sessions_filtered(&conn, &gp)?,
        None => query_sessions_all(&conn)?,
    };

    Ok(sessions)
}

fn query_sessions_filtered(conn: &Connection, group: &str) -> Result<Vec<Session>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, title, project_path, group_path, sort_order, status, tmux_session, \
             created_at, last_accessed, worktree_path, worktree_repo, worktree_branch, tool_data \
             FROM instances WHERE group_path = ?1 ORDER BY sort_order",
        )
        .map_err(|e| e.to_string())?;
    let result = stmt
        .query_map([group], |row| map_session_row(row))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(result)
}

fn query_sessions_all(conn: &Connection) -> Result<Vec<Session>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, title, project_path, group_path, sort_order, status, tmux_session, \
             created_at, last_accessed, worktree_path, worktree_repo, worktree_branch, tool_data \
             FROM instances ORDER BY group_path, sort_order",
        )
        .map_err(|e| e.to_string())?;
    let result = stmt
        .query_map([], |row| map_session_row(row))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(result)
}

#[tauri::command]
pub fn create_session(
    project_path: String,
    group: String,
    title: String,
    tool: Option<String>,
    worktree_branch: Option<String>,
    new_branch: bool,
) -> Result<String, String> {
    let tool_name = tool.unwrap_or_else(|| "claude".to_string());
    let mut args = vec![
        "add".to_string(),
        project_path,
        "-g".to_string(),
        group,
        "-t".to_string(),
        title,
        "-c".to_string(),
        tool_name,
    ];

    if let Some(branch) = worktree_branch {
        args.push("-w".to_string());
        args.push(branch);
        if new_branch {
            args.push("-b".to_string());
        }
    }

    let output = std::process::Command::new("agent-deck")
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to run agent-deck: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("agent-deck add failed: {}", stderr.trim()));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn map_session_row(row: &rusqlite::Row) -> rusqlite::Result<Session> {
    let tool_data_str: String = row.get(12)?;
    let claude_session_id = serde_json::from_str::<serde_json::Value>(&tool_data_str)
        .ok()
        .and_then(|v| v.get("claude_session_id")?.as_str().map(String::from));

    Ok(Session {
        id: row.get(0)?,
        title: row.get(1)?,
        project_path: row.get(2)?,
        group_path: row.get(3)?,
        sort_order: row.get(4)?,
        status: row.get(5)?,
        tmux_session: row.get(6)?,
        created_at: row.get(7)?,
        last_accessed: row.get(8)?,
        worktree_path: row.get(9)?,
        worktree_repo: row.get(10)?,
        worktree_branch: row.get(11)?,
        claude_session_id,
    })
}
