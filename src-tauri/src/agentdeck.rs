use rusqlite::Connection;
use std::path::{Path, PathBuf};

use crate::claude_logs::{self, AttentionStatus};
use crate::models::{AttentionCounts, Group, Session};

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
        .prepare(
            "SELECT path, name, expanded, sort_order, default_path FROM groups ORDER BY sort_order",
        )
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
        .query_map([group], map_session_row)
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
        .query_map([], map_session_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(result)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn create_session(
    project_path: String,
    group: String,
    title: String,
    tool: Option<String>,
    worktree_branch: Option<String>,
    new_branch: bool,
    start: Option<bool>,
    prompt: Option<String>,
) -> Result<String, String> {
    let tool_name = tool.unwrap_or_else(|| "claude".to_string());

    // If the project_path is a bare repo (has .bare subdir), resolve to an
    // existing worktree so agent-deck can find the git repo.
    let mut effective_path = if Path::new(&project_path).join(".bare").is_dir() {
        find_worktree_in_bare(&project_path)?
    } else {
        project_path
    };

    let bare_root = crate::git::find_bare_root(&effective_path);

    // For bare worktree repos, create the worktree ourselves so it lands at
    // <bare_root>/<branch> instead of agent-deck's default <dir>-<branch>.
    let bare_worktree_info = if let Some(ref root) = bare_root {
        if let Some(ref branch) = worktree_branch {
            let wt_path = root.join(branch);
            let wt_str = wt_path.to_string_lossy().to_string();
            let repo_root = effective_path.clone();

            let mut git_args = vec!["worktree", "add", &wt_str];
            if new_branch {
                git_args.push("-b");
            }
            git_args.push(branch);

            log::info!("git {} (cwd: {})", git_args.join(" "), effective_path);
            let output = std::process::Command::new("git")
                .current_dir(&effective_path)
                .args(&git_args)
                .output()
                .map_err(|e| format!("Failed to create worktree: {e}"))?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                log::error!(
                    "git worktree add failed (exit {}): {}",
                    output.status,
                    stderr.trim()
                );
                return Err(format!("Failed to create worktree: {}", stderr.trim()));
            }
            log::debug!("git worktree add succeeded: {wt_str}");

            effective_path = wt_str.clone();
            Some((wt_str, repo_root, branch.clone()))
        } else {
            None
        }
    } else {
        None
    };

    let mut args = vec![
        "add".to_string(),
        effective_path,
        "-g".to_string(),
        group,
        "-t".to_string(),
        title,
        "-c".to_string(),
        tool_name,
        "-json".to_string(),
    ];

    // Only let agent-deck handle worktree creation for non-bare repos
    if bare_worktree_info.is_none() {
        if let Some(branch) = worktree_branch {
            args.push("-w".to_string());
            args.push(branch);
            if new_branch {
                args.push("-b".to_string());
            }
        }
    }

    log::info!("agent-deck {}", args.join(" "));
    let output = std::process::Command::new("agent-deck")
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to run agent-deck: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::error!(
            "agent-deck add failed (exit {}): {}",
            output.status,
            stderr.trim()
        );
        return Err(format!("agent-deck add failed: {}", stderr.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    log::debug!("agent-deck add succeeded: {stdout}");

    // Parse session ID from output
    let session_id;

    // Try JSON output first (normal creation).
    // agent-deck may prefix the JSON with text like "Created worktree at: ...",
    // so find the first '{' and parse from there.
    let json_str = stdout.find('{').map(|i| &stdout[i..]).unwrap_or(&stdout);
    if let Some(id) = serde_json::from_str::<serde_json::Value>(json_str)
        .ok()
        .and_then(|json| json["id"].as_str().map(String::from))
    {
        session_id = id;
    }
    // Fall back: "Session already exists with same title and path: name (ID)"
    else if stdout.contains("already exists") {
        if let (Some(start), Some(end)) = (stdout.rfind('('), stdout.rfind(')')) {
            session_id = stdout[start + 1..end].to_string();
        } else {
            return Err(format!("Could not parse session ID from: {stdout}"));
        }
    } else {
        return Err(format!(
            "Could not parse session ID from agent-deck output: {stdout}"
        ));
    }

    // For bare repos where we created the worktree ourselves, update the
    // session's worktree metadata in the DB.
    if let Some((wt_path, wt_repo, wt_branch)) = bare_worktree_info {
        update_session_worktree(session_id.clone(), wt_path, wt_repo, wt_branch)?;
    }

    // Optionally start the session immediately
    if start.unwrap_or(false) {
        log::info!("agent-deck session start {session_id}");
        let start_output = std::process::Command::new("agent-deck")
            .args(["session", "start", &session_id])
            .output()
            .map_err(|e| format!("Failed to start session: {e}"))?;

        if !start_output.status.success() {
            let stderr = String::from_utf8_lossy(&start_output.stderr);
            log::error!(
                "agent-deck session start failed (exit {}): {}",
                start_output.status,
                stderr.trim()
            );
            return Err(format!(
                "agent-deck session start failed: {}",
                stderr.trim()
            ));
        }
        log::debug!("agent-deck session start succeeded for {session_id}");

        // Send prompt to the tmux session if provided
        if let Some(ref prompt_text) = prompt {
            if !prompt_text.trim().is_empty() {
                if let Err(e) = send_prompt_to_session(&session_id, prompt_text) {
                    log::error!("Failed to send prompt to session {session_id}: {e}");
                    // Don't fail the whole create — session was created successfully
                }
            }
        }
    }

    Ok(session_id)
}

#[tauri::command]
pub fn restart_session(session_id: String) -> Result<(), String> {
    log::info!("agent-deck session start {session_id}");
    let output = std::process::Command::new("agent-deck")
        .args(["session", "start", &session_id])
        .output()
        .map_err(|e| format!("Failed to run agent-deck: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::error!(
            "agent-deck session start failed (exit {}): {}",
            output.status,
            stderr.trim()
        );
        return Err(format!(
            "agent-deck session start failed: {}",
            stderr.trim()
        ));
    }

    log::debug!("agent-deck session start succeeded for {session_id}");
    Ok(())
}

#[tauri::command]
pub fn remove_session(session_id: String) -> Result<(), String> {
    // Try agent-deck remove first
    log::info!("agent-deck remove {session_id}");
    let remove_result = std::process::Command::new("agent-deck")
        .args(["remove", &session_id])
        .output();
    match &remove_result {
        Ok(output) if output.status.success() => {
            log::debug!("agent-deck remove succeeded for {session_id}");
        }
        Ok(output) => {
            log::error!(
                "agent-deck remove failed (exit {}): {}",
                output.status,
                String::from_utf8_lossy(&output.stderr).trim()
            );
        }
        Err(e) => {
            log::error!("agent-deck remove failed to execute: {e}");
        }
    }

    // agent-deck remove has a bug where worktree removal failure prevents
    // the DB deletion even though it reports success. Fall back to direct
    // DB deletion if the session still exists.
    let path = db_path();
    let conn = Connection::open(&path).map_err(|e| format!("Failed to open agent-deck DB: {e}"))?;

    conn.execute("DELETE FROM instances WHERE id = ?1", [&session_id])
        .map_err(|e| format!("Failed to delete session: {e}"))?;

    // Also clean up heartbeats
    let _ = conn.execute(
        "DELETE FROM instance_heartbeats WHERE instance_id = ?1",
        [&session_id],
    );

    Ok(())
}

#[tauri::command]
pub fn get_attention_counts() -> Result<AttentionCounts, String> {
    let path = db_path();
    let conn = Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Failed to open agent-deck DB at {}: {}", path.display(), e))?;

    // Fetch candidate sessions and refine with JSONL analysis
    let mut stmt = conn
        .prepare(
            "SELECT id, project_path, group_path, status, tool_data FROM instances \
             WHERE status IN ('waiting', 'error')",
        )
        .map_err(|e| e.to_string())?;

    let mut groups = std::collections::HashMap::new();
    let mut total = 0u32;

    let rows = stmt
        .query_map([], |row| {
            let tool_data_str: String = row.get(4)?;
            let claude_session_id = serde_json::from_str::<serde_json::Value>(&tool_data_str)
                .ok()
                .and_then(|v| v.get("claude_session_id")?.as_str().map(String::from));
            Ok((
                row.get::<_, String>(1)?, // project_path
                row.get::<_, String>(2)?, // group_path
                row.get::<_, String>(3)?, // status
                claude_session_id,
            ))
        })
        .map_err(|e| e.to_string())?;

    for row in rows {
        let (project_path, group_path, status, claude_session_id) =
            row.map_err(|e| e.to_string())?;

        let attention =
            claude_logs::compute_attention(&project_path, claude_session_id.as_deref(), &status);

        let refined_status = match attention {
            AttentionStatus::NeedsInput => "waiting",
            AttentionStatus::Error => "error",
            _ => continue, // skip non-actionable sessions
        };

        total += 1;
        // "waiting" (needs_input) takes priority over "error"
        let current = groups.get(&group_path);
        if current.is_none()
            || (current == Some(&"error".to_string()) && refined_status == "waiting")
        {
            groups.insert(group_path, refined_status.to_string());
        }
    }

    Ok(AttentionCounts { total, groups })
}

#[tauri::command]
pub fn get_attention_sessions() -> Result<Vec<Session>, String> {
    let path = db_path();
    let conn = Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Failed to open agent-deck DB at {}: {}", path.display(), e))?;

    let mut stmt = conn
        .prepare(
            "SELECT id, title, project_path, group_path, sort_order, status, tmux_session, \
             created_at, last_accessed, worktree_path, worktree_repo, worktree_branch, tool_data \
             FROM instances WHERE status IN ('waiting', 'error') ORDER BY group_path, sort_order",
        )
        .map_err(|e| e.to_string())?;

    let candidates = stmt
        .query_map([], map_session_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // Refine using JSONL analysis — only keep sessions that truly need attention
    let result = candidates
        .into_iter()
        .filter(|s| {
            let attention = claude_logs::compute_attention(
                &s.project_path,
                s.claude_session_id.as_deref(),
                &s.status,
            );
            matches!(
                attention,
                AttentionStatus::NeedsInput | AttentionStatus::Error
            )
        })
        .collect();

    Ok(result)
}

#[tauri::command]
pub fn update_session_worktree(
    session_id: String,
    worktree_path: String,
    worktree_repo: String,
    worktree_branch: String,
) -> Result<(), String> {
    let path = db_path();
    let conn = Connection::open(&path).map_err(|e| format!("Failed to open agent-deck DB: {e}"))?;

    conn.execute(
        "UPDATE instances SET worktree_path = ?1, worktree_repo = ?2, worktree_branch = ?3, project_path = ?1 WHERE id = ?4",
        rusqlite::params![worktree_path, worktree_repo, worktree_branch, session_id],
    )
    .map_err(|e| format!("Failed to update session worktree: {e}"))?;

    Ok(())
}

#[tauri::command]
pub fn create_group(name: String, default_path: String) -> Result<(), String> {
    let path = db_path();
    let conn = Connection::open(&path).map_err(|e| format!("Failed to open agent-deck DB: {e}"))?;

    // Use name as path (agent-deck convention)
    let group_path = name.clone();

    // Get max sort_order to append at end
    let max_sort: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort_order), -1) FROM groups",
            [],
            |row| row.get(0),
        )
        .unwrap_or(-1);

    conn.execute(
        "INSERT INTO groups (path, name, expanded, sort_order, default_path) VALUES (?1, ?2, 1, ?3, ?4)",
        rusqlite::params![group_path, name, max_sort + 1, default_path],
    )
    .map_err(|e| format!("Failed to create group: {e}"))?;

    Ok(())
}

#[tauri::command]
pub fn move_session(session_id: String, new_group_path: String) -> Result<(), String> {
    let path = db_path();
    let conn = Connection::open(&path).map_err(|e| format!("Failed to open agent-deck DB: {e}"))?;

    // Get max sort_order in target group to append at end
    let max_sort: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort_order), -1) FROM instances WHERE group_path = ?1",
            [&new_group_path],
            |row| row.get(0),
        )
        .unwrap_or(-1);

    conn.execute(
        "UPDATE instances SET group_path = ?1, sort_order = ?2 WHERE id = ?3",
        rusqlite::params![new_group_path, max_sort + 1, session_id],
    )
    .map_err(|e| format!("Failed to move session: {e}"))?;

    Ok(())
}

#[tauri::command]
pub fn rename_session(session_id: String, new_title: String) -> Result<(), String> {
    let path = db_path();
    let conn = Connection::open(&path).map_err(|e| format!("Failed to open agent-deck DB: {e}"))?;

    conn.execute(
        "UPDATE instances SET title = ?1 WHERE id = ?2",
        rusqlite::params![new_title, session_id],
    )
    .map_err(|e| format!("Failed to rename session: {e}"))?;

    Ok(())
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

/// Look up the tmux session name for a given session ID from the agent-deck DB.
fn get_tmux_session_name(session_id: &str) -> Result<String, String> {
    let path = db_path();
    let conn = Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Failed to open agent-deck DB: {e}"))?;

    conn.query_row(
        "SELECT tmux_session FROM instances WHERE id = ?1",
        [session_id],
        |row| row.get::<_, String>(0),
    )
    .map_err(|e| format!("Failed to get tmux session name for {session_id}: {e}"))
}

/// Send a prompt to a session's tmux session. Waits for the tmux session
/// to exist before sending.
fn send_prompt_to_session(session_id: &str, prompt: &str) -> Result<(), String> {
    let tmux_name = get_tmux_session_name(session_id)?;
    log::info!("Sending prompt to tmux session '{tmux_name}' for session {session_id}");

    // Wait for the tmux session to exist (agent-deck may take a moment to create it)
    let max_attempts = 30;
    let delay = std::time::Duration::from_millis(200);
    for attempt in 0..max_attempts {
        let check = std::process::Command::new("tmux")
            .args(["has-session", "-t", &tmux_name])
            .output();
        match check {
            Ok(output) if output.status.success() => {
                log::debug!(
                    "tmux session '{tmux_name}' found after {} attempts",
                    attempt + 1
                );
                break;
            }
            _ => {
                if attempt == max_attempts - 1 {
                    return Err(format!(
                        "tmux session '{}' not found after {}ms",
                        tmux_name,
                        max_attempts * 200
                    ));
                }
                std::thread::sleep(delay);
            }
        }
    }

    // Send the prompt text followed by Enter
    log::info!("tmux send-keys -t {tmux_name} -- <prompt> Enter");
    let output = std::process::Command::new("tmux")
        .args(["send-keys", "-t", &tmux_name, "--", prompt, "Enter"])
        .output()
        .map_err(|e| format!("Failed to send prompt via tmux: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("tmux send-keys failed: {}", stderr.trim()));
    }

    log::debug!("Prompt sent successfully to tmux session '{tmux_name}'");
    Ok(())
}

/// For bare worktree repos, find an existing worktree path that agent-deck
/// can use (it needs a real working tree, not the bare root).
fn find_worktree_in_bare(bare_path: &str) -> Result<String, String> {
    let cwd = Path::new(bare_path).join(".bare");
    log::info!("git worktree list --porcelain (cwd: {})", cwd.display());
    let output = std::process::Command::new("git")
        .current_dir(&cwd)
        .args(["worktree", "list", "--porcelain"])
        .output()
        .map_err(|e| format!("Failed to list worktrees: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::error!(
            "git worktree list failed (exit {}): {}",
            output.status,
            stderr.trim()
        );
        return Err(format!(
            "Failed to list worktrees in bare repo: {}",
            stderr.trim()
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    log::debug!("git worktree list succeeded: {}", stdout.trim());
    let mut found_bare = false;

    for line in stdout.lines() {
        if line == "bare" {
            found_bare = true;
            continue;
        }
        if line.starts_with("worktree ") {
            if found_bare {
                // This is the first non-bare worktree
                return Ok(line.strip_prefix("worktree ").unwrap().to_string());
            }
            // Reset bare flag for next entry
            found_bare = false;
        }
    }

    Err(format!("No worktrees found in bare repo at {bare_path}"))
}
