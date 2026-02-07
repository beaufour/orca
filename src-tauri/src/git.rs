use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Worktree {
    pub path: String,
    pub head: String,
    pub branch: String,
    pub is_bare: bool,
}

fn run_git(repo_path: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .current_dir(repo_path)
        .args(args)
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git {} failed: {}", args.join(" "), stderr.trim()));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
pub fn list_worktrees(repo_path: String) -> Result<Vec<Worktree>, String> {
    // Find the actual git dir - might be a worktree itself, so go up to find .bare or .git
    let effective_repo = find_repo_root(&repo_path)?;
    let output = run_git(&effective_repo, &["worktree", "list", "--porcelain"])?;

    let mut worktrees = Vec::new();
    let mut current_path = String::new();
    let mut current_head = String::new();
    let mut current_branch = String::new();
    let mut is_bare = false;

    for line in output.lines() {
        if line.starts_with("worktree ") {
            if !current_path.is_empty() {
                worktrees.push(Worktree {
                    path: current_path.clone(),
                    head: current_head.clone(),
                    branch: current_branch.clone(),
                    is_bare,
                });
            }
            current_path = line.strip_prefix("worktree ").unwrap().to_string();
            current_head = String::new();
            current_branch = String::new();
            is_bare = false;
        } else if line.starts_with("HEAD ") {
            current_head = line.strip_prefix("HEAD ").unwrap().to_string();
        } else if line.starts_with("branch ") {
            let full_ref = line.strip_prefix("branch ").unwrap();
            current_branch = full_ref
                .strip_prefix("refs/heads/")
                .unwrap_or(full_ref)
                .to_string();
        } else if line == "bare" {
            is_bare = true;
        }
    }

    // Push the last entry
    if !current_path.is_empty() {
        worktrees.push(Worktree {
            path: current_path,
            head: current_head,
            branch: current_branch,
            is_bare,
        });
    }

    // Filter out the bare repo entry
    worktrees.retain(|w| !w.is_bare);

    Ok(worktrees)
}

#[tauri::command]
pub fn add_worktree(repo_path: String, branch: String) -> Result<String, String> {
    let effective_repo = find_repo_root(&repo_path)?;

    // Determine the parent directory for worktrees
    let repo_root = Path::new(&effective_repo);
    let parent = repo_root
        .parent()
        .ok_or("Cannot determine parent directory")?;

    let worktree_path = parent.join(&branch);
    let worktree_str = worktree_path.to_string_lossy().to_string();

    // Create a new branch and worktree
    run_git(
        &effective_repo,
        &["worktree", "add", &worktree_str, "-b", &branch],
    )?;

    Ok(worktree_str)
}

#[tauri::command]
pub fn remove_worktree(repo_path: String, worktree_path: String) -> Result<(), String> {
    let effective_repo = find_repo_root(&repo_path)?;

    // Get the branch name before removing
    let worktrees = list_worktrees(repo_path)?;
    let branch = worktrees
        .iter()
        .find(|w| w.path == worktree_path)
        .map(|w| w.branch.clone());

    run_git(
        &effective_repo,
        &["worktree", "remove", &worktree_path, "--force"],
    )?;

    // Clean up the branch
    if let Some(branch_name) = branch {
        if branch_name != "main" && branch_name != "master" {
            let _ = run_git(&effective_repo, &["branch", "-D", &branch_name]);
        }
    }

    Ok(())
}

#[tauri::command]
pub fn merge_worktree(
    repo_path: String,
    branch: String,
    main_branch: Option<String>,
) -> Result<(), String> {
    let effective_repo = find_repo_root(&repo_path)?;
    let target = main_branch.unwrap_or_else(|| "main".to_string());

    // Find the main worktree path
    let worktrees = list_worktrees(repo_path.clone())?;
    let main_wt = worktrees
        .iter()
        .find(|w| w.branch == target)
        .ok_or(format!("Could not find worktree for branch '{}'", target))?;

    // Merge the branch into main from the main worktree
    run_git(&main_wt.path, &["merge", &branch])?;

    // Find and remove the branch worktree
    if let Some(branch_wt) = worktrees.iter().find(|w| w.branch == branch) {
        let _ = run_git(&effective_repo, &["worktree", "remove", &branch_wt.path]);
        let _ = run_git(&effective_repo, &["branch", "-d", &branch]);
    }

    Ok(())
}

#[tauri::command]
pub fn rebase_worktree(worktree_path: String, main_branch: Option<String>) -> Result<(), String> {
    let target = main_branch.unwrap_or_else(|| "main".to_string());

    // Fetch latest and rebase
    let _ = run_git(&worktree_path, &["fetch", "origin", &target]);
    run_git(&worktree_path, &["rebase", &target])?;

    Ok(())
}

fn find_repo_root(path: &str) -> Result<String, String> {
    // Use git rev-parse to find the toplevel or bare repo
    let output = Command::new("git")
        .current_dir(path)
        .args(["rev-parse", "--git-common-dir"])
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if !output.status.success() {
        return Err(format!("Not a git repository: {}", path));
    }

    let git_common = String::from_utf8_lossy(&output.stdout).trim().to_string();

    // If it's a bare repo (.bare directory), the repo root is that directory
    let common_path = if Path::new(&git_common).is_absolute() {
        git_common
    } else {
        Path::new(path)
            .join(&git_common)
            .to_string_lossy()
            .to_string()
    };

    // For worktree operations, we need a non-bare worktree path
    // Use the common dir's parent if it ends in .bare
    if common_path.ends_with(".bare") || common_path.ends_with(".bare/") {
        // For bare repos, we need an actual worktree to run commands from
        // Just use the provided path since it should be a worktree
        Ok(path.to_string())
    } else {
        Ok(path.to_string())
    }
}
