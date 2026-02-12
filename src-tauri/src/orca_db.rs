use rusqlite::Connection;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Settings for a group, stored in Orca's own DB.
#[derive(Debug, Clone)]
pub struct GroupSettings {
    pub github_issues_enabled: bool,
    pub merge_workflow: String,
    pub worktree_command: Option<String>,
    pub component_depth: u32,
}

/// Orca's own SQLite database for data that shouldn't be stored in agent-deck's DB.
#[derive(Clone)]
pub struct OrcaDb {
    db_path: PathBuf,
}

impl OrcaDb {
    /// Initialize Orca's database: create directory, open DB, create tables,
    /// and run one-time migration from agent-deck's DB.
    pub fn init(app_data_dir: &Path) -> Result<Self, String> {
        std::fs::create_dir_all(app_data_dir)
            .map_err(|e| format!("Failed to create app data dir: {e}"))?;

        let db_path = app_data_dir.join("orca.db");
        let orca_db = Self { db_path };

        let conn = orca_db.open()?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS group_settings (
                group_path            TEXT PRIMARY KEY,
                github_issues_enabled INTEGER NOT NULL DEFAULT 1,
                merge_workflow        TEXT NOT NULL DEFAULT 'merge'
            );
            CREATE TABLE IF NOT EXISTS session_data (
                session_id TEXT PRIMARY KEY,
                prompt     TEXT
            );
            CREATE TABLE IF NOT EXISTS metadata (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );",
        )
        .map_err(|e| format!("Failed to create Orca DB tables: {e}"))?;

        orca_db.run_migration_v1(&conn)?;

        Ok(orca_db)
    }

    fn open(&self) -> Result<Connection, String> {
        Connection::open(&self.db_path)
            .map_err(|e| format!("Failed to open Orca DB at {}: {e}", self.db_path.display()))
    }

    /// Bulk read all group settings for merging into get_groups().
    pub fn get_all_group_settings(&self) -> Result<HashMap<String, GroupSettings>, String> {
        let conn = self.open()?;
        Self::ensure_merge_workflow_column(&conn)?;
        Self::ensure_worktree_columns(&conn)?;
        let mut stmt = conn
            .prepare(
                "SELECT group_path, github_issues_enabled, merge_workflow, \
                 worktree_command, component_depth FROM group_settings",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    GroupSettings {
                        github_issues_enabled: row.get::<_, i32>(1)? != 0,
                        merge_workflow: row
                            .get::<_, String>(2)
                            .unwrap_or_else(|_| "merge".to_string()),
                        worktree_command: row.get::<_, Option<String>>(3)?,
                        component_depth: row.get::<_, u32>(4).unwrap_or(2),
                    },
                ))
            })
            .map_err(|e| e.to_string())?;

        let mut map = HashMap::new();
        for row in rows {
            let (path, settings) = row.map_err(|e| e.to_string())?;
            map.insert(path, settings);
        }
        Ok(map)
    }

    /// Update group settings (upsert).
    pub fn update_group_settings(
        &self,
        group_path: &str,
        github_issues_enabled: bool,
        merge_workflow: &str,
        worktree_command: Option<&str>,
        component_depth: u32,
    ) -> Result<(), String> {
        let conn = self.open()?;
        Self::ensure_merge_workflow_column(&conn)?;
        Self::ensure_worktree_columns(&conn)?;
        conn.execute(
            "INSERT INTO group_settings (group_path, github_issues_enabled, merge_workflow, \
             worktree_command, component_depth) VALUES (?1, ?2, ?3, ?4, ?5) \
             ON CONFLICT(group_path) DO UPDATE SET github_issues_enabled = ?2, \
             merge_workflow = ?3, worktree_command = ?4, component_depth = ?5",
            rusqlite::params![
                group_path,
                github_issues_enabled as i32,
                merge_workflow,
                worktree_command,
                component_depth
            ],
        )
        .map_err(|e| format!("Failed to update group settings: {e}"))?;
        Ok(())
    }

    /// Get the worktree command and component depth for a group.
    pub fn get_group_worktree_command(
        &self,
        group_path: &str,
    ) -> Result<Option<(String, u32)>, String> {
        let conn = self.open()?;
        Self::ensure_worktree_columns(&conn)?;
        let result = conn.query_row(
            "SELECT worktree_command, component_depth FROM group_settings WHERE group_path = ?1",
            [group_path],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, u32>(1).unwrap_or(2),
                ))
            },
        );
        match result {
            Ok((Some(cmd), depth)) if !cmd.is_empty() => Ok(Some((cmd, depth))),
            Ok(_) => Ok(None),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(format!("Failed to get worktree command: {e}")),
        }
    }

    /// Ensure merge_workflow column exists (for DBs created before it was added).
    fn ensure_merge_workflow_column(conn: &Connection) -> Result<(), String> {
        let has_column: bool = conn
            .prepare("PRAGMA table_info(group_settings)")
            .map_err(|e| e.to_string())?
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|e| e.to_string())?
            .any(|name| name.as_deref() == Ok("merge_workflow"));

        if !has_column {
            conn.execute(
                "ALTER TABLE group_settings ADD COLUMN merge_workflow TEXT NOT NULL DEFAULT 'merge'",
                [],
            )
            .map_err(|e| format!("Failed to add merge_workflow column: {e}"))?;
        }
        Ok(())
    }

    /// Ensure worktree_command and component_depth columns exist.
    fn ensure_worktree_columns(conn: &Connection) -> Result<(), String> {
        let columns: Vec<String> = conn
            .prepare("PRAGMA table_info(group_settings)")
            .map_err(|e| e.to_string())?
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|e| e.to_string())?
            .collect::<Result<_, _>>()
            .map_err(|e| e.to_string())?;

        if !columns.iter().any(|c| c == "worktree_command") {
            conn.execute(
                "ALTER TABLE group_settings ADD COLUMN worktree_command TEXT",
                [],
            )
            .map_err(|e| format!("Failed to add worktree_command column: {e}"))?;
        }
        if !columns.iter().any(|c| c == "component_depth") {
            conn.execute(
                "ALTER TABLE group_settings ADD COLUMN component_depth INTEGER NOT NULL DEFAULT 2",
                [],
            )
            .map_err(|e| format!("Failed to add component_depth column: {e}"))?;
        }
        Ok(())
    }

    /// Bulk read all session prompts for merging into get_sessions().
    pub fn get_all_prompts(&self) -> Result<HashMap<String, String>, String> {
        let conn = self.open()?;
        let mut stmt = conn
            .prepare("SELECT session_id, prompt FROM session_data WHERE prompt IS NOT NULL")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;

        let mut map = HashMap::new();
        for row in rows {
            let (id, prompt) = row.map_err(|e| e.to_string())?;
            map.insert(id, prompt);
        }
        Ok(map)
    }

    /// Store a prompt for a session (upsert).
    pub fn store_prompt(&self, session_id: &str, prompt: &str) -> Result<(), String> {
        let conn = self.open()?;
        conn.execute(
            "INSERT INTO session_data (session_id, prompt) VALUES (?1, ?2) \
             ON CONFLICT(session_id) DO UPDATE SET prompt = ?2",
            rusqlite::params![session_id, prompt],
        )
        .map_err(|e| format!("Failed to store prompt: {e}"))?;
        Ok(())
    }

    /// Clean up session data when a session is removed.
    pub fn delete_session_data(&self, session_id: &str) -> Result<(), String> {
        let conn = self.open()?;
        conn.execute(
            "DELETE FROM session_data WHERE session_id = ?1",
            [session_id],
        )
        .map_err(|e| format!("Failed to delete session data: {e}"))?;
        Ok(())
    }

    /// Ensure the dismissed column exists (for DBs created before it was added).
    fn ensure_dismissed_column(conn: &Connection) -> Result<(), String> {
        let has_column: bool = conn
            .prepare("PRAGMA table_info(session_data)")
            .map_err(|e| e.to_string())?
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|e| e.to_string())?
            .any(|name| name.as_deref() == Ok("dismissed"));

        if !has_column {
            conn.execute(
                "ALTER TABLE session_data ADD COLUMN dismissed INTEGER NOT NULL DEFAULT 0",
                [],
            )
            .map_err(|e| format!("Failed to add dismissed column: {e}"))?;
        }
        Ok(())
    }

    /// Get all dismissed session IDs.
    pub fn get_dismissed_ids(&self) -> Result<Vec<String>, String> {
        let conn = self.open()?;
        Self::ensure_dismissed_column(&conn)?;
        let mut stmt = conn
            .prepare("SELECT session_id FROM session_data WHERE dismissed = 1")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        let mut ids = Vec::new();
        for row in rows {
            ids.push(row.map_err(|e| e.to_string())?);
        }
        Ok(ids)
    }

    /// Set or clear the dismissed flag for a session (upsert).
    pub fn set_dismissed(&self, session_id: &str, dismissed: bool) -> Result<(), String> {
        let conn = self.open()?;
        Self::ensure_dismissed_column(&conn)?;
        conn.execute(
            "INSERT INTO session_data (session_id, dismissed) VALUES (?1, ?2) \
             ON CONFLICT(session_id) DO UPDATE SET dismissed = ?2",
            rusqlite::params![session_id, dismissed as i32],
        )
        .map_err(|e| format!("Failed to set dismissed: {e}"))?;
        Ok(())
    }

    /// One-time migration: copy github_issues_enabled and prompt data from
    /// agent-deck's DB into Orca's own DB.
    fn run_migration_v1(&self, conn: &Connection) -> Result<(), String> {
        // Check if already done
        let done: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM metadata WHERE key = 'migration_v1'",
                [],
                |row| row.get::<_, i32>(0),
            )
            .map_err(|e| e.to_string())?
            > 0;
        if done {
            return Ok(());
        }

        log::info!("Running one-time migration v1 from agent-deck DB to Orca DB");

        let ad_path = agent_deck_db_path();
        if !ad_path.exists() {
            log::info!("Agent-deck DB not found, skipping migration");
            conn.execute(
                "INSERT INTO metadata (key, value) VALUES ('migration_v1', 'done')",
                [],
            )
            .map_err(|e| e.to_string())?;
            return Ok(());
        }

        let ad_conn =
            Connection::open_with_flags(&ad_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
                .map_err(|e| format!("Failed to open agent-deck DB for migration: {e}"))?;

        // Migrate github_issues_enabled if the column exists
        let has_column: bool = ad_conn
            .prepare("PRAGMA table_info(groups)")
            .map_err(|e| e.to_string())?
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|e| e.to_string())?
            .any(|name| name.as_deref() == Ok("github_issues_enabled"));

        // Check for merge_workflow column too
        let has_merge_workflow: bool = ad_conn
            .prepare("PRAGMA table_info(groups)")
            .map_err(|e| e.to_string())?
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|e| e.to_string())?
            .any(|name| name.as_deref() == Ok("merge_workflow"));

        if has_column || has_merge_workflow {
            let select_cols = match (has_column, has_merge_workflow) {
                (true, true) => "path, github_issues_enabled, merge_workflow",
                (true, false) => "path, github_issues_enabled, 'merge'",
                (false, true) => "path, 1, merge_workflow",
                (false, false) => unreachable!(),
            };
            let sql = format!("SELECT {select_cols} FROM groups");
            let mut stmt = ad_conn.prepare(&sql).map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i32>(1)?,
                        row.get::<_, String>(2)
                            .unwrap_or_else(|_| "merge".to_string()),
                    ))
                })
                .map_err(|e| e.to_string())?;

            for row in rows {
                let (path, enabled, workflow) = row.map_err(|e| e.to_string())?;
                conn.execute(
                    "INSERT OR IGNORE INTO group_settings (group_path, github_issues_enabled, merge_workflow) VALUES (?1, ?2, ?3)",
                    rusqlite::params![path, enabled, workflow],
                )
                .map_err(|e| e.to_string())?;
            }
            log::info!("Migrated group settings from agent-deck DB");
        }

        // Migrate prompt from tool_data JSON
        let mut stmt = ad_conn
            .prepare("SELECT id, tool_data FROM instances")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;

        let mut prompt_count = 0u32;
        for row in rows {
            let (id, tool_data_str) = row.map_err(|e| e.to_string())?;
            if let Some(prompt) = serde_json::from_str::<serde_json::Value>(&tool_data_str)
                .ok()
                .and_then(|v| v.get("prompt")?.as_str().map(String::from))
            {
                conn.execute(
                    "INSERT OR IGNORE INTO session_data (session_id, prompt) VALUES (?1, ?2)",
                    rusqlite::params![id, prompt],
                )
                .map_err(|e| e.to_string())?;
                prompt_count += 1;
            }
        }
        log::info!("Migrated {prompt_count} prompts from agent-deck tool_data");

        // Mark migration as done
        conn.execute(
            "INSERT INTO metadata (key, value) VALUES ('migration_v1', 'done')",
            [],
        )
        .map_err(|e| e.to_string())?;

        log::info!("Migration v1 complete");
        Ok(())
    }
}

fn agent_deck_db_path() -> PathBuf {
    let home = dirs::home_dir().expect("could not find home directory");
    home.join(".agent-deck/profiles/default/state.db")
}
