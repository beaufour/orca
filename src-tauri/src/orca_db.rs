use rusqlite::Connection;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

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
                github_issues_enabled INTEGER NOT NULL DEFAULT 1
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
    pub fn get_all_group_settings(&self) -> Result<HashMap<String, bool>, String> {
        let conn = self.open()?;
        let mut stmt = conn
            .prepare("SELECT group_path, github_issues_enabled FROM group_settings")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i32>(1)? != 0))
            })
            .map_err(|e| e.to_string())?;

        let mut map = HashMap::new();
        for row in rows {
            let (path, enabled) = row.map_err(|e| e.to_string())?;
            map.insert(path, enabled);
        }
        Ok(map)
    }

    /// Set github_issues_enabled for a group (upsert).
    pub fn set_github_issues_enabled(&self, group_path: &str, enabled: bool) -> Result<(), String> {
        let conn = self.open()?;
        conn.execute(
            "INSERT INTO group_settings (group_path, github_issues_enabled) VALUES (?1, ?2) \
             ON CONFLICT(group_path) DO UPDATE SET github_issues_enabled = ?2",
            rusqlite::params![group_path, enabled as i32],
        )
        .map_err(|e| format!("Failed to set github_issues_enabled: {e}"))?;
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

        if has_column {
            let mut stmt = ad_conn
                .prepare("SELECT path, github_issues_enabled FROM groups")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, i32>(1)?))
                })
                .map_err(|e| e.to_string())?;

            for row in rows {
                let (path, enabled) = row.map_err(|e| e.to_string())?;
                conn.execute(
                    "INSERT OR IGNORE INTO group_settings (group_path, github_issues_enabled) VALUES (?1, ?2)",
                    rusqlite::params![path, enabled],
                )
                .map_err(|e| e.to_string())?;
            }
            log::info!("Migrated github_issues_enabled from agent-deck DB");
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
