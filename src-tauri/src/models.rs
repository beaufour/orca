use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubIssue {
    pub number: u64,
    pub title: String,
    pub body: String,
    pub state: String,
    pub labels: Vec<GitHubLabel>,
    pub assignee: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub html_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubLabel {
    pub name: String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttentionCounts {
    /// Total number of sessions needing action (waiting or error).
    pub total: u32,
    /// Per-group worst status: "waiting" (needs input) or "error".
    pub groups: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Group {
    pub path: String,
    pub name: String,
    pub expanded: bool,
    pub sort_order: i32,
    pub default_path: String,
    pub github_issues_enabled: bool,
    pub is_git_repo: bool,
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
    pub prompt: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionCheck {
    pub supported: String,
    pub installed: String,
}
