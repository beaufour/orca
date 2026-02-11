use crate::command::new_command;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Worktree {
    pub path: String,
    pub head: String,
    pub branch: String,
    pub is_bare: bool,
}

/// Expand ~ in paths to the home directory.
fn expand_tilde(path: &str) -> PathBuf {
    if let Some(stripped) = path.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(stripped);
        }
    }
    PathBuf::from(path)
}

/// Run a git command, returning (stdout, success) without treating non-zero exit as an error.
fn run_git_status(repo_path: &str, args: &[&str]) -> Result<(String, bool), String> {
    let expanded = expand_tilde(repo_path);
    let cwd = expanded.to_string_lossy();
    log::info!("git {} (cwd: {})", args.join(" "), cwd);
    let output = new_command("git")
        .current_dir(cwd.as_ref())
        .args(args)
        .output()
        .map_err(|e| format!("Failed to run git: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    Ok((stdout, output.status.success()))
}

fn run_git(repo_path: &str, args: &[&str]) -> Result<String, String> {
    let expanded = expand_tilde(repo_path);
    let cwd = expanded.to_string_lossy();
    log::info!("git {} (cwd: {})", args.join(" "), cwd);
    let output = new_command("git")
        .current_dir(cwd.as_ref())
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

/// Parse the porcelain output of `git worktree list --porcelain` into Worktree structs.
/// Filters out bare entries.
pub fn parse_worktree_list(output: &str) -> Vec<Worktree> {
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

    worktrees
}

#[tauri::command]
pub fn list_worktrees(repo_path: String) -> Result<Vec<Worktree>, String> {
    // Find the actual git dir - might be a worktree itself, so go up to find .bare or .git
    let effective_repo = find_repo_root(&repo_path)?;
    let output = run_git(&effective_repo, &["worktree", "list", "--porcelain"])?;
    Ok(parse_worktree_list(&output))
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeResult {
    pub success: bool,
    pub main_worktree_path: String,
    pub conflict_message: Option<String>,
}

#[tauri::command]
pub fn try_merge_branch(
    repo_path: String,
    branch: String,
    main_branch: Option<String>,
) -> Result<MergeResult, String> {
    let target = main_branch.unwrap_or_else(|| "main".to_string());

    // Find the main worktree path
    let worktrees = list_worktrees(repo_path)?;
    let main_wt = worktrees
        .iter()
        .find(|w| w.branch == target)
        .ok_or(format!("No worktree found for branch '{target}'"))?;
    let main_path = main_wt.path.clone();

    // Check if main worktree has uncommitted changes
    let (status_output, status_ok) = run_git_status(&main_path, &["status", "--porcelain"])?;
    if status_ok && !status_output.trim().is_empty() {
        return Err(format!(
            "The '{target}' worktree has uncommitted changes. Please commit or stash them before merging."
        ));
    }

    // Best-effort pull on main (ignore failure — may be offline or no remote)
    let _ = run_git_status(&main_path, &["pull", "--ff-only"]);

    // Try merge — need both stdout and stderr for conflict info
    log::info!("git merge {branch} --no-edit (cwd: {main_path})");
    let merge_output = new_command("git")
        .current_dir(&main_path)
        .args(["merge", &branch, "--no-edit"])
        .output()
        .map_err(|e| format!("Failed to run git merge: {e}"))?;

    if merge_output.status.success() {
        Ok(MergeResult {
            success: true,
            main_worktree_path: main_path,
            conflict_message: None,
        })
    } else {
        let stdout = String::from_utf8_lossy(&merge_output.stdout);
        let stderr = String::from_utf8_lossy(&merge_output.stderr);
        let message = format!("{}{}", stdout.trim(), stderr.trim());
        log::warn!("git merge conflict/failure: {message}");
        Ok(MergeResult {
            success: false,
            main_worktree_path: main_path,
            conflict_message: Some(message),
        })
    }
}

#[tauri::command]
pub fn abort_merge(worktree_path: String) -> Result<(), String> {
    run_git(&worktree_path, &["merge", "--abort"])?;
    Ok(())
}

/// Detect the default branch from a bare repo by checking origin refs.
fn detect_default_branch(bare_path: &str) -> Result<String, String> {
    // Try symbolic-ref of origin/HEAD first
    if let Ok(output) = run_git(bare_path, &["symbolic-ref", "refs/remotes/origin/HEAD"]) {
        let trimmed = output.trim();
        if let Some(branch) = trimmed.strip_prefix("refs/remotes/origin/") {
            return Ok(branch.to_string());
        }
    }

    // Fallback: check if remote tracking branches exist for main or master
    if run_git(
        bare_path,
        &["rev-parse", "--verify", "refs/remotes/origin/main"],
    )
    .is_ok()
    {
        return Ok("main".to_string());
    }
    if run_git(
        bare_path,
        &["rev-parse", "--verify", "refs/remotes/origin/master"],
    )
    .is_ok()
    {
        return Ok("master".to_string());
    }

    Ok("main".to_string())
}

/// Expand `~/` prefix to the user's home directory.
fn expand_home(path: &str) -> Result<String, String> {
    if let Some(rest) = path.strip_prefix("~/") {
        let home = dirs::home_dir().ok_or("Could not determine home directory")?;
        Ok(home.join(rest).to_string_lossy().to_string())
    } else {
        Ok(path.to_string())
    }
}

#[tauri::command]
pub fn clone_bare_worktree_repo(
    git_url: String,
    project_name: String,
    parent_dir: String,
) -> Result<String, String> {
    // Validate inputs
    if git_url.trim().is_empty() {
        return Err("Git URL cannot be empty".to_string());
    }
    if project_name.trim().is_empty() {
        return Err("Project name cannot be empty".to_string());
    }
    if project_name.contains('/') || project_name.contains('\\') {
        return Err("Project name cannot contain path separators".to_string());
    }

    let parent = expand_home(parent_dir.trim())?;
    let parent_path = Path::new(&parent);
    if !parent_path.is_dir() {
        return Err(format!("Parent directory does not exist: {parent}"));
    }

    let project_path = parent_path.join(project_name.trim());
    if project_path.exists() {
        return Err(format!(
            "Directory already exists: {}",
            project_path.display()
        ));
    }

    // Create project directory
    std::fs::create_dir_all(&project_path)
        .map_err(|e| format!("Failed to create project directory: {e}"))?;

    let project_str = project_path.to_string_lossy().to_string();

    // From here on, clean up on failure
    let result = clone_bare_worktree_inner(&project_path, &project_str, git_url.trim());
    if result.is_err() {
        log::warn!("Clone failed, cleaning up {project_str}");
        let _ = std::fs::remove_dir_all(&project_path);
    }

    result
}

fn clone_bare_worktree_inner(
    project_path: &Path,
    project_str: &str,
    git_url: &str,
) -> Result<String, String> {
    // git clone --bare $URL .bare
    let bare_path = project_path.join(".bare");
    let bare_str = bare_path.to_string_lossy().to_string();

    log::info!("git clone --bare {git_url} {bare_str}");
    let output = new_command("git")
        .args(["clone", "--bare", git_url, &bare_str])
        .output()
        .map_err(|e| format!("Failed to run git clone: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git clone --bare failed: {}", stderr.trim()));
    }

    // Write .git file pointing to .bare
    let git_file = project_path.join(".git");
    std::fs::write(&git_file, "gitdir: ./.bare\n")
        .map_err(|e| format!("Failed to write .git file: {e}"))?;

    // Configure fetch refspec
    run_git(
        project_str,
        &[
            "config",
            "remote.origin.fetch",
            "+refs/heads/*:refs/remotes/origin/*",
        ],
    )?;

    // Fetch all branches
    run_git(project_str, &["fetch", "origin"])?;

    // Detect default branch
    let default_branch = detect_default_branch(project_str)?;
    log::info!("Detected default branch: {default_branch}");

    // Create worktree for default branch
    let wt_path = project_path.join(&default_branch);
    let wt_str = wt_path.to_string_lossy().to_string();
    run_git(project_str, &["worktree", "add", &wt_str, &default_branch])?;

    Ok(project_str.to_string())
}

#[tauri::command]
pub fn init_bare_repo(directory: String) -> Result<String, String> {
    let expanded = expand_home(directory.trim())?;
    let project_path = Path::new(&expanded);

    // Create directory if it doesn't exist
    if !project_path.exists() {
        std::fs::create_dir_all(project_path)
            .map_err(|e| format!("Failed to create directory: {e}"))?;
    }

    if project_path.join(".bare").exists() {
        return Err("Directory already contains a .bare repo".to_string());
    }
    if project_path.join(".git").exists() {
        return Err("Directory already contains a git repo".to_string());
    }

    let project_str = project_path.to_string_lossy().to_string();
    let result = init_bare_repo_inner(project_path, &project_str);
    if result.is_err() {
        log::warn!("init_bare_repo failed, cleaning up {project_str}");
        let _ = std::fs::remove_dir_all(project_path.join(".bare"));
        let _ = std::fs::remove_file(project_path.join(".git"));
        let _ = std::fs::remove_dir_all(project_path.join("main"));
    }
    result
}

fn init_bare_repo_inner(project_path: &Path, project_str: &str) -> Result<String, String> {
    // 1. git init --bare .bare
    let bare_path = project_path.join(".bare");
    let bare_str = bare_path.to_string_lossy().to_string();

    log::info!("git init --bare {bare_str}");
    let output = new_command("git")
        .args(["init", "--bare", &bare_str])
        .output()
        .map_err(|e| format!("Failed to run git init: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git init --bare failed: {}", stderr.trim()));
    }

    // 2. Write .git file pointing to .bare
    std::fs::write(project_path.join(".git"), "gitdir: ./.bare\n")
        .map_err(|e| format!("Failed to write .git file: {e}"))?;

    // 3. Create main worktree with --orphan
    let wt_path = project_path.join("main");
    let wt_str = wt_path.to_string_lossy().to_string();
    run_git(
        project_str,
        &["worktree", "add", &wt_str, "--orphan", "-b", "main"],
    )?;

    // 4. Create initial empty commit in the worktree
    run_git(
        &wt_str,
        &["commit", "--allow-empty", "-m", "Initial commit"],
    )?;

    Ok(project_str.to_string())
}

fn find_repo_root(path: &str) -> Result<String, String> {
    // Validate this is a git repository by checking rev-parse succeeds.
    // Returns the expanded path since git commands work from any worktree.
    let expanded = expand_tilde(path);
    let cwd = expanded.to_string_lossy();
    log::info!("git rev-parse --git-common-dir (cwd: {cwd})");
    let output = new_command("git")
        .current_dir(cwd.as_ref())
        .args(["rev-parse", "--git-common-dir"])
        .output()
        .map_err(|e| format!("Failed to run git: {e}"))?;

    if !output.status.success() {
        log::error!(
            "git rev-parse --git-common-dir failed (exit {}): not a git repo at {}",
            output.status,
            cwd
        );
        return Err(format!("Not a git repository: {cwd}"));
    }

    log::debug!(
        "git rev-parse --git-common-dir succeeded: {}",
        String::from_utf8_lossy(&output.stdout).trim()
    );
    Ok(cwd.to_string())
}

/// Walk up from `path` looking for a directory containing `.bare/`.
/// Returns the bare repo root (the directory with `.bare/` inside it),
/// or None if this is not a bare worktree setup.
pub fn find_bare_root(path: &str) -> Option<std::path::PathBuf> {
    let expanded = expand_tilde(path);
    let mut current = expanded.as_path();
    loop {
        if current.join(".bare").is_dir() {
            return Some(current.to_path_buf());
        }
        current = current.parent()?;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_empty_input() {
        let result = parse_worktree_list("");
        assert!(result.is_empty());
    }

    #[test]
    fn parse_single_worktree() {
        let output = "\
worktree /home/user/repo/main
HEAD abc123def456
branch refs/heads/main
";
        let result = parse_worktree_list(output);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].path, "/home/user/repo/main");
        assert_eq!(result[0].head, "abc123def456");
        assert_eq!(result[0].branch, "main");
        assert!(!result[0].is_bare);
    }

    #[test]
    fn parse_multiple_worktrees() {
        let output = "\
worktree /home/user/repo/main
HEAD abc123
branch refs/heads/main

worktree /home/user/repo/feature
HEAD def456
branch refs/heads/feature-branch
";
        let result = parse_worktree_list(output);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].branch, "main");
        assert_eq!(result[1].branch, "feature-branch");
    }

    #[test]
    fn parse_filters_bare_entry() {
        let output = "\
worktree /home/user/repo
HEAD abc123
bare

worktree /home/user/repo/main
HEAD def456
branch refs/heads/main
";
        let result = parse_worktree_list(output);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].path, "/home/user/repo/main");
    }

    #[test]
    fn parse_detached_head() {
        let output = "\
worktree /home/user/repo/detached
HEAD abc123
detached
";
        let result = parse_worktree_list(output);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].head, "abc123");
        assert_eq!(result[0].branch, ""); // no branch line for detached HEAD
    }

    #[test]
    fn parse_strips_refs_heads_prefix() {
        let output = "\
worktree /home/user/repo/feature
HEAD abc123
branch refs/heads/my-feature
";
        let result = parse_worktree_list(output);
        assert_eq!(result[0].branch, "my-feature");
    }

    #[test]
    fn parse_branch_without_refs_heads() {
        let output = "\
worktree /home/user/repo/feature
HEAD abc123
branch some-other-ref
";
        let result = parse_worktree_list(output);
        assert_eq!(result[0].branch, "some-other-ref");
    }
}
