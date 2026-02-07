use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Group {
    pub path: String,
    pub name: String,
    pub expanded: bool,
    pub sort_order: i32,
    pub default_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub title: String,
    pub project_path: String,
    pub group_path: String,
    pub sort_order: i32,
    pub status: String,
    pub tmux_session: String,
    pub created_at: i64,
    pub last_accessed: i64,
    pub worktree_path: String,
    pub worktree_repo: String,
    pub worktree_branch: String,
    pub claude_session_id: Option<String>,
}
