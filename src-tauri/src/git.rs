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

/// Run a git command, returning (stdout, success) without treating non-zero exit as an error.
fn run_git_status(repo_path: &str, args: &[&str]) -> Result<(String, bool), String> {
    log::info!("git {} (cwd: {})", args.join(" "), repo_path);
    let output = Command::new("git")
        .current_dir(repo_path)
        .args(args)
        .output()
        .map_err(|e| format!("Failed to run git: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    Ok((stdout, output.status.success()))
}

fn run_git(repo_path: &str, args: &[&str]) -> Result<String, String> {
    log::info!("git {} (cwd: {})", args.join(" "), repo_path);
    let output = Command::new("git")
        .current_dir(repo_path)
        .args(args)
        .output()
        .map_err(|e| format!("Failed to run git: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::error!(
            "git {} failed (exit {}): {}",
            args.join(" "),
            output.status,
            stderr.trim()
        );
        return Err(format!("git {} failed: {}", args.join(" "), stderr.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    log::debug!("git {} succeeded: {}", args.join(" "), stdout.trim());
    Ok(stdout)
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
        .ok_or(format!("Could not find worktree for branch '{target}'"))?;

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
    let range = format!("{default_branch}...{branch}");
    run_git(&worktree_path, &["diff", &range])
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorktreeStatus {
    pub has_dirty_files: bool,
    pub has_unmerged_branch: bool,
    pub has_unpushed_commits: bool,
    pub warnings: Vec<String>,
}

#[tauri::command]
pub fn check_worktree_status(
    repo_path: String,
    worktree_path: String,
    branch: String,
) -> Result<WorktreeStatus, String> {
    let mut warnings = Vec::new();

    // 1. Check for dirty files (uncommitted changes)
    let (status_output, _) = run_git_status(&worktree_path, &["status", "--porcelain"])?;
    let has_dirty_files = !status_output.trim().is_empty();
    if has_dirty_files {
        let file_count = status_output.trim().lines().count();
        warnings.push(format!(
            "{file_count} uncommitted change{}",
            if file_count == 1 { "" } else { "s" }
        ));
    }

    // 2. Check if branch is merged into default branch (skip for main/master)
    let default_branch = get_default_branch_inner(&repo_path)?;
    let has_unmerged_branch = if branch != "main" && branch != "master" && branch != default_branch
    {
        let (_, is_ancestor) = run_git_status(
            &worktree_path,
            &["merge-base", "--is-ancestor", &branch, &default_branch],
        )?;
        if !is_ancestor {
            warnings.push(format!(
                "Branch '{branch}' not merged into {default_branch}"
            ));
        }
        !is_ancestor
    } else {
        false
    };

    // 3. Check for unpushed commits (skip if already merged — work is safe)
    let has_unpushed_commits = if !has_unmerged_branch {
        false
    } else {
        // Try upstream tracking ref first
        let (log_output, ok) =
            run_git_status(&worktree_path, &["log", "@{upstream}..HEAD", "--oneline"])?;
        if ok {
            let unpushed = !log_output.trim().is_empty();
            if unpushed {
                let count = log_output.trim().lines().count();
                warnings.push(format!(
                    "{count} unpushed commit{}",
                    if count == 1 { "" } else { "s" }
                ));
            }
            unpushed
        } else {
            // No upstream — try origin/<branch>
            let remote_ref = format!("origin/{branch}");
            let range = format!("{remote_ref}..HEAD");
            let (log_output, ok) = run_git_status(&worktree_path, &["log", &range, "--oneline"])?;
            if ok {
                let unpushed = !log_output.trim().is_empty();
                if unpushed {
                    let count = log_output.trim().lines().count();
                    warnings.push(format!(
                        "{count} unpushed commit{}",
                        if count == 1 { "" } else { "s" }
                    ));
                }
                unpushed
            } else {
                // No remote branch at all
                warnings.push("No remote tracking branch".to_string());
                true
            }
        }
    };

    Ok(WorktreeStatus {
        has_dirty_files,
        has_unmerged_branch,
        has_unpushed_commits,
        warnings,
    })
}

fn find_repo_root(path: &str) -> Result<String, String> {
    // Validate this is a git repository by checking rev-parse succeeds.
    // Returns the input path since git commands work from any worktree.
    log::info!("git rev-parse --git-common-dir (cwd: {path})");
    let output = Command::new("git")
        .current_dir(path)
        .args(["rev-parse", "--git-common-dir"])
        .output()
        .map_err(|e| format!("Failed to run git: {e}"))?;

    if !output.status.success() {
        log::error!(
            "git rev-parse --git-common-dir failed (exit {}): not a git repo at {}",
            output.status,
            path
        );
        return Err(format!("Not a git repository: {path}"));
    }

    log::debug!(
        "git rev-parse --git-common-dir succeeded: {}",
        String::from_utf8_lossy(&output.stdout).trim()
    );
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
