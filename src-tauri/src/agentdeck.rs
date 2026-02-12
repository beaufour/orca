use crate::command::{expand_tilde, new_command};
use crate::orca_db::OrcaDb;
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use tauri::{Emitter, State};

use crate::claude_logs::{self, AttentionStatus};
use crate::models::{AttentionCounts, Group, Session, VersionCheck};

const SUPPORTED_VERSION: &str = "0.13.0";

fn db_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    Ok(home.join(".agent-deck/profiles/default/state.db"))
}

fn open_db() -> Result<Connection, String> {
    let path = db_path()?;
    Connection::open(&path)
        .map_err(|e| format!("Failed to open agent-deck DB at {}: {e}", path.display()))
}

fn open_db_readonly() -> Result<Connection, String> {
    let path = db_path()?;
    Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Failed to open agent-deck DB at {}: {e}", path.display()))
}

#[tauri::command]
pub fn check_agent_deck_version() -> Result<VersionCheck, String> {
    let output = new_command("agent-deck")
        .arg("version")
        .output()
        .map_err(|e| format!("Failed to run agent-deck version: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("agent-deck version failed: {}", stderr.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    // Parse "Agent Deck v0.13.0" → "0.13.0"
    let installed = stdout
        .strip_prefix("Agent Deck v")
        .unwrap_or(&stdout)
        .to_string();

    Ok(VersionCheck {
        supported: SUPPORTED_VERSION.to_string(),
        installed,
    })
}

#[tauri::command]
pub fn get_groups(orca_db: State<'_, OrcaDb>) -> Result<Vec<Group>, String> {
    log::debug!("get_groups");
    let conn = open_db_readonly()?;

    let settings = orca_db.get_all_group_settings().unwrap_or_default();

    let mut stmt = conn
        .prepare(
            "SELECT path, name, expanded, sort_order, default_path FROM groups ORDER BY sort_order",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(Group {
                path: row.get(0)?,
                name: row.get(1)?,
                expanded: row.get::<_, i32>(2)? != 0,
                sort_order: row.get(3)?,
                default_path: row.get(4)?,
                github_issues_enabled: true,         // populated below
                is_git_repo: false,                  // computed below
                merge_workflow: "merge".to_string(), // populated below
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let groups = rows
        .into_iter()
        .map(|mut g| {
            if let Some((enabled, workflow)) = settings.get(&g.path) {
                g.github_issues_enabled = *enabled;
                g.merge_workflow = workflow.clone();
            }
            let expanded = expand_tilde(&g.default_path);
            g.is_git_repo = new_command("git")
                .current_dir(&expanded)
                .args(["rev-parse", "--git-common-dir"])
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false);
            g
        })
        .collect::<Vec<_>>();

    log::debug!("get_groups: found {} groups", groups.len());
    Ok(groups)
}

#[tauri::command]
pub fn update_group_settings(
    orca_db: State<'_, OrcaDb>,
    group_path: String,
    github_issues_enabled: bool,
    merge_workflow: String,
) -> Result<(), String> {
    orca_db.update_group_settings(&group_path, github_issues_enabled, &merge_workflow)
}

#[tauri::command]
pub fn get_sessions(
    orca_db: State<'_, OrcaDb>,
    group_path: Option<String>,
) -> Result<Vec<Session>, String> {
    log::debug!("get_sessions: group_path={group_path:?}");
    let conn = open_db_readonly()?;

    let mut sessions = query_sessions(&conn, group_path.as_deref())?;

    let prompts = orca_db.get_all_prompts().unwrap_or_default();
    for session in &mut sessions {
        if let Some(prompt) = prompts.get(&session.id) {
            session.prompt = Some(prompt.clone());
        }
    }

    log::debug!("get_sessions: found {} sessions", sessions.len());
    Ok(sessions)
}

fn query_sessions(conn: &Connection, group_path: Option<&str>) -> Result<Vec<Session>, String> {
    let columns = "id, title, project_path, group_path, sort_order, status, tmux_session, \
                    created_at, last_accessed, worktree_path, worktree_repo, worktree_branch, tool_data";
    let sql = match group_path {
        Some(_) => {
            format!("SELECT {columns} FROM instances WHERE group_path = ?1 ORDER BY sort_order")
        }
        None => format!("SELECT {columns} FROM instances ORDER BY group_path, sort_order"),
    };
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = match group_path {
        Some(gp) => stmt.query_map([gp], map_session_row),
        None => stmt.query_map([], map_session_row),
    };
    let mut result = rows
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    fix_last_accessed(&mut result);
    Ok(result)
}

/// Resolve the effective working path for session creation.
/// For bare repos (with .bare subdir), resolves to an existing worktree path.
fn resolve_effective_path(project_path: &str) -> Result<String, String> {
    let expanded = expand_tilde(project_path);
    let path_str = expanded.to_string_lossy().to_string();
    if expanded.join(".bare").is_dir() {
        find_worktree_in_bare(&path_str)
    } else {
        Ok(path_str)
    }
}

/// For bare worktree repos, create the worktree at <bare_root>/<branch>
/// instead of agent-deck's default <dir>-<branch> layout.
/// Returns (worktree_path, repo_root, branch) if created, None otherwise.
fn create_bare_worktree(
    effective_path: &str,
    worktree_branch: Option<&str>,
    new_branch: bool,
) -> Result<Option<(String, String, String)>, String> {
    let Some(bare_root) = crate::git::find_bare_root(effective_path) else {
        return Ok(None);
    };
    let Some(branch) = worktree_branch else {
        return Ok(None);
    };

    let wt_path = bare_root.join(branch);
    let wt_str = wt_path.to_string_lossy().to_string();

    let mut git_args = vec!["worktree", "add", &wt_str];
    if new_branch {
        git_args.push("-b");
    }
    git_args.push(branch);

    crate::command::run_cmd("git", effective_path, &git_args)
        .map_err(|e| format!("Failed to create worktree: {e}"))?;

    Ok(Some((
        wt_str,
        effective_path.to_string(),
        branch.to_string(),
    )))
}

/// Run `agent-deck add` and parse the session ID from the output.
fn run_agent_deck_add(args: &[String]) -> Result<String, String> {
    log::info!("agent-deck {}", args.join(" "));
    let output = new_command("agent-deck")
        .args(args)
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
    parse_session_id(&stdout)
}

/// Parse a session ID from agent-deck output (JSON or fallback text format).
fn parse_session_id(stdout: &str) -> Result<String, String> {
    // Try JSON output first (normal creation).
    // agent-deck may prefix the JSON with text like "Created worktree at: ...",
    // so find the first '{' and parse from there.
    let json_str = stdout.find('{').map(|i| &stdout[i..]).unwrap_or(stdout);
    if let Some(id) = serde_json::from_str::<serde_json::Value>(json_str)
        .ok()
        .and_then(|json| json["id"].as_str().map(String::from))
    {
        return Ok(id);
    }

    // Fall back: "Session already exists with same title and path: name (ID)"
    if stdout.contains("already exists") {
        if let (Some(start), Some(end)) = (stdout.rfind('('), stdout.rfind(')')) {
            return Ok(stdout[start + 1..end].to_string());
        }
    }

    Err(format!(
        "Could not parse session ID from agent-deck output: {stdout}"
    ))
}

/// Start an agent-deck session via CLI.
fn start_agent_deck_session(session_id: &str) -> Result<(), String> {
    log::info!("agent-deck session start {session_id}");
    let output = new_command("agent-deck")
        .args(["session", "start", session_id])
        .output()
        .map_err(|e| format!("Failed to start session: {e}"))?;

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

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn create_session(
    app: tauri::AppHandle,
    orca_db: State<'_, OrcaDb>,
    creation_id: String,
    project_path: String,
    group: String,
    title: String,
    tool: Option<String>,
    worktree_branch: Option<String>,
    new_branch: bool,
    start: Option<bool>,
    prompt: Option<String>,
) -> Result<(), String> {
    let orca_db = orca_db.inner().clone();
    // Spawn the work to a background thread and return immediately
    std::thread::spawn(move || {
        match create_session_impl(
            project_path,
            group,
            title,
            tool,
            worktree_branch,
            new_branch,
            start,
            prompt.clone(),
        ) {
            Ok(session_id) => {
                // Store prompt in Orca's DB
                if let Some(ref prompt_text) = prompt {
                    if !prompt_text.trim().is_empty() {
                        if let Err(e) = orca_db.store_prompt(&session_id, prompt_text) {
                            log::error!("Failed to store prompt for {session_id}: {e}");
                        }
                    }
                }
                let _ = app.emit(
                    "session-created",
                    serde_json::json!({
                        "creation_id": creation_id,
                        "session_id": session_id,
                    }),
                );
            }
            Err(error) => {
                let _ = app.emit(
                    "session-creation-failed",
                    serde_json::json!({
                        "creation_id": creation_id,
                        "error": error,
                    }),
                );
            }
        }
    });
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn create_session_impl(
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
    let mut effective_path = resolve_effective_path(&project_path)?;

    // For bare repos with no worktree branch (i.e. a "main session"), resolve
    // to the default branch worktree so the session points at main, not
    // whatever worktree happened to be passed in.
    if worktree_branch.is_none() && crate::git::find_bare_root(&effective_path).is_some() {
        if let Ok(default_wt) = find_default_branch_worktree(&effective_path) {
            effective_path = default_wt;
        }
    }

    // For bare worktree repos, create the worktree ourselves
    let bare_worktree_info =
        create_bare_worktree(&effective_path, worktree_branch.as_deref(), new_branch)?;
    if let Some((ref wt_str, _, _)) = bare_worktree_info {
        effective_path = wt_str.clone();
    }

    // Build agent-deck add arguments
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

    let session_id = run_agent_deck_add(&args)?;

    // For bare repos where we created the worktree ourselves, update the
    // session's worktree metadata in the DB.
    if let Some((wt_path, wt_repo, wt_branch)) = bare_worktree_info {
        update_session_worktree(session_id.clone(), wt_path, wt_repo, wt_branch)?;
    }

    // Optionally start the session immediately
    if start.unwrap_or(false) {
        start_agent_deck_session(&session_id)?;

        // Send prompt to the tmux session in the background so we don't
        // block the UI while waiting for Claude Code to start up.
        if let Some(ref prompt_text) = prompt {
            if !prompt_text.trim().is_empty() {
                let sid = session_id.clone();
                let pt = prompt_text.clone();
                std::thread::spawn(move || {
                    if let Err(e) = send_prompt_to_session(&sid, &pt) {
                        log::error!("Failed to send prompt to session {sid}: {e}");
                    }
                });
            }
        }
    }

    Ok(session_id)
}

#[tauri::command]
pub fn restart_session(session_id: String) -> Result<(), String> {
    start_agent_deck_session(&session_id)
}

#[tauri::command]
pub fn remove_session(orca_db: State<'_, OrcaDb>, session_id: String) -> Result<(), String> {
    // Try agent-deck remove first
    log::info!("agent-deck remove {session_id}");
    let remove_result = new_command("agent-deck")
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
    let conn = open_db()?;

    conn.execute("DELETE FROM instances WHERE id = ?1", [&session_id])
        .map_err(|e| format!("Failed to delete session: {e}"))?;

    // Clean up Orca's own data for this session
    if let Err(e) = orca_db.delete_session_data(&session_id) {
        log::error!("Failed to clean up Orca session data for {session_id}: {e}");
    }

    Ok(())
}

#[tauri::command]
pub fn get_attention_counts() -> Result<AttentionCounts, String> {
    let conn = open_db_readonly()?;

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

    let mut candidate_count = 0u32;
    for row in rows {
        let (project_path, group_path, status, claude_session_id) =
            row.map_err(|e| e.to_string())?;
        candidate_count += 1;

        // tmux check not needed — this query only covers "waiting"/"error"
        let attention = claude_logs::compute_attention(
            &project_path,
            claude_session_id.as_deref(),
            &status,
            None,
        );

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

    log::debug!("get_attention_counts: {candidate_count} candidates, {total} need attention");
    Ok(AttentionCounts { total, groups })
}

#[tauri::command]
pub fn get_attention_sessions(orca_db: State<'_, OrcaDb>) -> Result<Vec<Session>, String> {
    let conn = open_db_readonly()?;

    let mut stmt = conn
        .prepare(
            "SELECT id, title, project_path, group_path, sort_order, status, tmux_session, \
             created_at, last_accessed, worktree_path, worktree_repo, worktree_branch, tool_data \
             FROM instances WHERE status IN ('waiting', 'error') ORDER BY group_path, sort_order",
        )
        .map_err(|e| e.to_string())?;

    let mut candidates = stmt
        .query_map([], map_session_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    fix_last_accessed(&mut candidates);

    let prompts = orca_db.get_all_prompts().unwrap_or_default();

    // Refine using JSONL analysis — only keep sessions that truly need attention
    let result = candidates
        .into_iter()
        .filter(|s| {
            // tmux check not needed — this query only covers "waiting"/"error"
            let attention = claude_logs::compute_attention(
                &s.project_path,
                s.claude_session_id.as_deref(),
                &s.status,
                None,
            );
            matches!(
                attention,
                AttentionStatus::NeedsInput | AttentionStatus::Error
            )
        })
        .map(|mut s| {
            if let Some(prompt) = prompts.get(&s.id) {
                s.prompt = Some(prompt.clone());
            }
            s
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
    log::info!("update_session_worktree: session_id={session_id}, branch={worktree_branch}");
    let conn = open_db()?;

    conn.execute(
        "UPDATE instances SET worktree_path = ?1, worktree_repo = ?2, worktree_branch = ?3, project_path = ?1 WHERE id = ?4",
        rusqlite::params![worktree_path, worktree_repo, worktree_branch, session_id],
    )
    .map_err(|e| format!("Failed to update session worktree: {e}"))?;

    Ok(())
}

#[tauri::command]
pub fn clear_session_worktree(session_id: String) -> Result<(), String> {
    log::info!("clear_session_worktree: session_id={session_id}");
    let conn = open_db()?;

    // Get the worktree_repo so we can reset project_path to it
    let repo: String = conn
        .query_row(
            "SELECT worktree_repo FROM instances WHERE id = ?1",
            [&session_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to get session {session_id}: {e}"))?;

    conn.execute(
        "UPDATE instances SET project_path = ?1, worktree_path = '', worktree_repo = '', worktree_branch = '' WHERE id = ?2",
        rusqlite::params![repo, session_id],
    )
    .map_err(|e| format!("Failed to clear session worktree: {e}"))?;

    Ok(())
}

#[tauri::command]
pub fn create_group(name: String, default_path: String) -> Result<(), String> {
    log::info!("create_group: name={name}, default_path={default_path}");
    let conn = open_db()?;

    // Expand tilde in default_path before storing
    let expanded_default_path = expand_tilde(&default_path);
    // If the path is inside a bare worktree repo, resolve to the bare root
    // so the group always references the repo root, not a specific worktree.
    let default_path_str = if let Some(bare_root) =
        crate::git::find_bare_root(&expanded_default_path.to_string_lossy())
    {
        bare_root.to_string_lossy().to_string()
    } else {
        expanded_default_path.to_string_lossy().to_string()
    };

    // Get max sort_order to append at end
    let max_sort: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort_order), -1) FROM groups",
            [],
            |row| row.get(0),
        )
        .unwrap_or(-1);

    // Use name as both path and name (agent-deck convention)
    conn.execute(
        "INSERT INTO groups (path, name, expanded, sort_order, default_path) VALUES (?1, ?2, 1, ?3, ?4)",
        rusqlite::params![name, name, max_sort + 1, default_path_str],
    )
    .map_err(|e| format!("Failed to create group: {e}"))?;

    Ok(())
}

#[tauri::command]
pub fn move_session(session_id: String, new_group_path: String) -> Result<(), String> {
    log::info!("move_session: session_id={session_id}, new_group_path={new_group_path}");
    let conn = open_db()?;

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
    log::info!("rename_session: session_id={session_id}, new_title={new_title}");
    let conn = open_db()?;

    conn.execute(
        "UPDATE instances SET title = ?1 WHERE id = ?2",
        rusqlite::params![new_title, session_id],
    )
    .map_err(|e| format!("Failed to rename session: {e}"))?;

    Ok(())
}

fn map_session_row(row: &rusqlite::Row) -> rusqlite::Result<Session> {
    let tool_data_str: String = row.get(12)?;
    let tool_data = serde_json::from_str::<serde_json::Value>(&tool_data_str).ok();
    let claude_session_id = tool_data
        .as_ref()
        .and_then(|v| v.get("claude_session_id")?.as_str().map(String::from));
    let pr_url = tool_data
        .as_ref()
        .and_then(|v| v.get("pr_url")?.as_str().map(String::from));
    let pr_number = tool_data
        .as_ref()
        .and_then(|v| v.get("pr_number")?.as_u64());
    let pr_state = tool_data
        .as_ref()
        .and_then(|v| v.get("pr_state")?.as_str().map(String::from));

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
        prompt: None, // populated by caller from Orca DB
        pr_url,
        pr_number,
        pr_state,
    })
}

/// Fix up `last_accessed` for sessions where agent-deck stores a bogus value
/// (e.g. Go's zero time). Falls back to the JSONL log file's modification time.
fn fix_last_accessed(sessions: &mut [Session]) {
    for session in sessions.iter_mut() {
        if session.last_accessed <= 0 {
            if let Some(ref csid) = session.claude_session_id {
                if let Some(jsonl_path) = claude_logs::find_jsonl_path(&session.project_path, csid)
                {
                    if let Ok(meta) = std::fs::metadata(&jsonl_path) {
                        if let Ok(modified) = meta.modified() {
                            if let Ok(dur) = modified.duration_since(std::time::UNIX_EPOCH) {
                                session.last_accessed = dur.as_secs() as i64;
                            }
                        }
                    }
                }
            }
        }
    }
}

/// Store PR info in the session's tool_data JSON.
#[tauri::command]
pub fn store_session_pr_info(
    session_id: String,
    pr_url: String,
    pr_number: u64,
    pr_state: String,
) -> Result<(), String> {
    log::info!("store_session_pr_info: session_id={session_id}, pr_number={pr_number}, pr_state={pr_state}");
    let conn = open_db()?;

    let current: String = conn
        .query_row(
            "SELECT tool_data FROM instances WHERE id = ?1",
            [&session_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to read tool_data for {session_id}: {e}"))?;

    let mut data: serde_json::Value =
        serde_json::from_str(&current).unwrap_or(serde_json::json!({}));
    data["pr_url"] = serde_json::Value::String(pr_url);
    data["pr_number"] = serde_json::json!(pr_number);
    data["pr_state"] = serde_json::Value::String(pr_state);

    let updated = serde_json::to_string(&data).map_err(|e| format!("JSON serialize error: {e}"))?;
    conn.execute(
        "UPDATE instances SET tool_data = ?1 WHERE id = ?2",
        rusqlite::params![updated, session_id],
    )
    .map_err(|e| format!("Failed to update tool_data for {session_id}: {e}"))?;

    Ok(())
}

/// Look up the tmux session name for a given session ID from the agent-deck DB.
fn get_tmux_session_name(session_id: &str) -> Result<String, String> {
    let conn = open_db_readonly()?;

    conn.query_row(
        "SELECT tmux_session FROM instances WHERE id = ?1",
        [session_id],
        |row| row.get::<_, String>(0),
    )
    .map_err(|e| format!("Failed to get tmux session name for {session_id}: {e}"))
}

/// Send a prompt to a session's tmux session. Waits for the tmux session
/// to exist and for Claude Code to start rendering before sending.
/// Runs on a background thread — must not block the UI.
fn send_prompt_to_session(session_id: &str, prompt: &str) -> Result<(), String> {
    let tmux_name = get_tmux_session_name(session_id)?;
    log::info!("Sending prompt to tmux session '{tmux_name}' for session {session_id}");

    let max_attempts = 60;
    let delay = std::time::Duration::from_millis(500);
    let mut session_ready = false;

    for attempt in 0..max_attempts {
        // Use capture-pane: if the session doesn't exist it fails,
        // if it does we can check whether Claude has started rendering.
        let capture = new_command("tmux")
            .args(["capture-pane", "-t", &tmux_name, "-p"])
            .output();
        match capture {
            Ok(output) if output.status.success() => {
                let content = String::from_utf8_lossy(&output.stdout);
                // Wait until the pane has non-whitespace content — means
                // Claude Code has started and rendered something.
                if content.chars().any(|c| !c.is_whitespace()) {
                    log::debug!(
                        "Claude Code rendering in tmux session '{tmux_name}' after {} attempts",
                        attempt + 1
                    );
                    session_ready = true;
                    break;
                }
            }
            _ => {} // tmux session doesn't exist yet or command failed
        }
        if attempt < max_attempts - 1 {
            std::thread::sleep(delay);
        }
    }

    if !session_ready {
        return Err(format!(
            "Claude Code not ready in tmux session '{tmux_name}' after {}s",
            max_attempts as u64 * 500 / 1000
        ));
    }

    // Give Claude Code a moment to finish initializing after first render
    std::thread::sleep(std::time::Duration::from_secs(2));

    // Send the prompt text first (literal mode to avoid key name interpretation)
    log::info!("tmux send-keys -l -t {tmux_name} -- <prompt>");
    let text_output = new_command("tmux")
        .args(["send-keys", "-l", "-t", &tmux_name, "--", prompt])
        .output()
        .map_err(|e| format!("Failed to send prompt text via tmux: {e}"))?;

    if !text_output.status.success() {
        let stderr = String::from_utf8_lossy(&text_output.stderr);
        return Err(format!("tmux send-keys (text) failed: {}", stderr.trim()));
    }

    // Brief pause so the TUI processes the text before we submit
    std::thread::sleep(std::time::Duration::from_millis(200));

    // Send Enter separately to submit the prompt
    log::info!("tmux send-keys -t {tmux_name} Enter");
    let output = new_command("tmux")
        .args(["send-keys", "-t", &tmux_name, "Enter"])
        .output()
        .map_err(|e| format!("Failed to send Enter via tmux: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("tmux send-keys (Enter) failed: {}", stderr.trim()));
    }

    log::debug!("Prompt sent successfully to tmux session '{tmux_name}'");
    Ok(())
}

/// For bare worktree repos, find an existing worktree path that agent-deck
/// can use (it needs a real working tree, not the bare root).
fn find_worktree_in_bare(bare_path: &str) -> Result<String, String> {
    let cwd = Path::new(bare_path).join(".bare");
    log::info!("git worktree list --porcelain (cwd: {})", cwd.display());
    let output = new_command("git")
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
        if let Some(path) = line.strip_prefix("worktree ") {
            if found_bare {
                // This is the first non-bare worktree
                return Ok(path.to_string());
            }
            // Reset bare flag for next entry
            found_bare = false;
        }
    }

    Err(format!("No worktrees found in bare repo at {bare_path}"))
}

/// Find the worktree for the default branch (main/master) in a bare repo.
/// `any_worktree` should be a path inside the repo (used to run git commands).
fn find_default_branch_worktree(any_worktree: &str) -> Result<String, String> {
    let output = new_command("git")
        .current_dir(any_worktree)
        .args(["worktree", "list", "--porcelain"])
        .output()
        .map_err(|e| format!("Failed to list worktrees: {e}"))?;

    if !output.status.success() {
        return Err("Failed to list worktrees".to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let worktrees = crate::git::parse_worktree_list(&stdout);

    // Determine default branch name
    let default_branch = new_command("git")
        .current_dir(any_worktree)
        .args(["symbolic-ref", "refs/remotes/origin/HEAD"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| {
            let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
            s.strip_prefix("refs/remotes/origin/").map(str::to_string)
        })
        .unwrap_or_else(|| "main".to_string());

    // Find the worktree on the default branch
    if let Some(wt) = worktrees.iter().find(|w| w.branch == default_branch) {
        return Ok(wt.path.clone());
    }
    // Fallback: try "master" if default was "main" or vice versa
    let fallback = if default_branch == "main" {
        "master"
    } else {
        "main"
    };
    if let Some(wt) = worktrees.iter().find(|w| w.branch == fallback) {
        return Ok(wt.path.clone());
    }

    Err(format!(
        "No worktree found for default branch '{default_branch}'"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_session_id_json() {
        let output = r#"{"id":"abc-123","title":"test"}"#;
        assert_eq!(parse_session_id(output).unwrap(), "abc-123");
    }

    #[test]
    fn parse_session_id_json_with_prefix() {
        let output = r#"Created worktree at: /tmp/wt
{"id":"def-456","title":"test"}"#;
        assert_eq!(parse_session_id(output).unwrap(), "def-456");
    }

    #[test]
    fn parse_session_id_already_exists() {
        let output = "Session already exists with same title and path: my-session (xyz-789)";
        assert_eq!(parse_session_id(output).unwrap(), "xyz-789");
    }

    #[test]
    fn parse_session_id_unparseable() {
        let output = "something unexpected";
        assert!(parse_session_id(output).is_err());
    }
}
