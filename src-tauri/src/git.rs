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

    // For bare worktree repos, place new worktrees as siblings of .bare/.
    // For regular repos, place as siblings of the repo directory.
    let worktree_dir = if let Some(bare_root) = find_bare_root(&effective_repo) {
        bare_root
    } else {
        Path::new(&effective_repo)
            .parent()
            .ok_or("Cannot determine parent directory")?
            .to_path_buf()
    };

    let worktree_path = worktree_dir.join(&branch);
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

fn get_default_branch_inner(repo_path: &str) -> Result<String, String> {
    // Try symbolic-ref of origin/HEAD first
    if let Ok(output) = run_git(repo_path, &["symbolic-ref", "refs/remotes/origin/HEAD"]) {
        let trimmed = output.trim();
        if let Some(branch) = trimmed.strip_prefix("refs/remotes/origin/") {
            return Ok(branch.to_string());
        }
    }

    // Fallback: check if "main" or "master" branches exist
    if run_git(repo_path, &["rev-parse", "--verify", "main"]).is_ok() {
        return Ok("main".to_string());
    }
    if run_git(repo_path, &["rev-parse", "--verify", "master"]).is_ok() {
        return Ok("master".to_string());
    }

    Ok("main".to_string())
}

#[tauri::command]
pub fn get_default_branch(repo_path: String) -> Result<String, String> {
    get_default_branch_inner(&repo_path)
}

#[tauri::command]
pub fn get_branch_diff(worktree_path: String, branch: String) -> Result<String, String> {
    let default_branch = get_default_branch_inner(&worktree_path)?;
    let range = format!("{}...{}", default_branch, branch);
    run_git(&worktree_path, &["diff", &range])
}

fn find_repo_root(path: &str) -> Result<String, String> {
    // Validate this is a git repository by checking rev-parse succeeds.
    // Returns the input path since git commands work from any worktree.
    let output = Command::new("git")
        .current_dir(path)
        .args(["rev-parse", "--git-common-dir"])
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if !output.status.success() {
        return Err(format!("Not a git repository: {}", path));
    }

    Ok(path.to_string())
}

/// Walk up from `path` looking for a directory containing `.bare/`.
/// Returns the bare repo root (the directory with `.bare/` inside it),
/// or None if this is not a bare worktree setup.
pub fn find_bare_root(path: &str) -> Option<std::path::PathBuf> {
    let mut current = Path::new(path);
    loop {
        if current.join(".bare").is_dir() {
            return Some(current.to_path_buf());
        }
        current = current.parent()?;
    }
}
