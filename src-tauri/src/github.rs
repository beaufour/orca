use crate::command::new_command;
use crate::git::find_bare_root;
use crate::models::{GitHubIssue, GitHubLabel};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Raw shape returned by `gh issue list/view --json ...`
#[derive(Debug, Deserialize)]
struct GhIssue {
    number: u64,
    title: String,
    body: String,
    state: String,
    labels: Vec<GhLabel>,
    assignees: Vec<GhAssignee>,
    #[serde(rename = "createdAt")]
    created_at: String,
    #[serde(rename = "updatedAt")]
    updated_at: String,
    url: String,
}

#[derive(Debug, Deserialize)]
struct GhLabel {
    name: String,
    color: String,
}

#[derive(Debug, Deserialize)]
struct GhAssignee {
    login: String,
}

fn to_github_issue(raw: GhIssue) -> GitHubIssue {
    GitHubIssue {
        number: raw.number,
        title: raw.title,
        body: raw.body,
        state: raw.state,
        labels: raw
            .labels
            .into_iter()
            .map(|l| GitHubLabel {
                name: l.name,
                color: l.color,
            })
            .collect(),
        assignee: raw.assignees.into_iter().next().map(|a| a.login),
        created_at: raw.created_at,
        updated_at: raw.updated_at,
        html_url: raw.url,
    }
}

const GH_JSON_FIELDS: &str = "number,title,body,state,labels,assignees,createdAt,updatedAt,url";

/// Expand ~ in paths to the home directory.
fn expand_tilde(path: &str) -> PathBuf {
    if let Some(stripped) = path.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(stripped);
        }
    }
    PathBuf::from(path)
}

/// Extract `owner/repo` from the git remote origin URL.
fn get_owner_repo(repo_path: &str) -> Result<String, String> {
    // Expand tilde in path
    let expanded = expand_tilde(repo_path);
    let expanded_str = expanded.to_string_lossy();

    // For bare repos, use the .bare/ directory as cwd
    let cwd = if let Some(bare_root) = find_bare_root(&expanded_str) {
        bare_root.join(".bare").to_string_lossy().to_string()
    } else {
        expanded_str.to_string()
    };

    // Check if the directory exists
    if !Path::new(&cwd).exists() {
        return Err(format!("Repository path does not exist: {cwd}"));
    }

    let output = new_command("git")
        .current_dir(&cwd)
        .args(["remote", "get-url", "origin"])
        .output()
        .map_err(|e| format!("Failed to run git in {cwd}: {e}"))?;

    if !output.status.success() {
        return Err("No git remote 'origin' found".to_string());
    }

    let url = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let result = parse_owner_repo(&url);
    if let Ok(ref owner_repo) = result {
        log::debug!("get_owner_repo: resolved {repo_path} -> {owner_repo}");
    }
    result
}

fn parse_owner_repo(url: &str) -> Result<String, String> {
    // SSH: git@github.com:owner/repo.git
    if let Some(rest) = url.strip_prefix("git@github.com:") {
        let repo = rest.strip_suffix(".git").unwrap_or(rest);
        return Ok(repo.to_string());
    }
    // HTTPS: https://github.com/owner/repo.git
    if let Some(rest) = url
        .strip_prefix("https://github.com/")
        .or_else(|| url.strip_prefix("http://github.com/"))
    {
        let repo = rest.strip_suffix(".git").unwrap_or(rest);
        return Ok(repo.to_string());
    }
    Err(format!("Cannot parse GitHub owner/repo from URL: {url}"))
}

fn run_gh(repo_path: &str, args: &[&str]) -> Result<String, String> {
    // Expand tilde in path
    let expanded = expand_tilde(repo_path);
    let cwd = expanded.to_string_lossy().to_string();

    log::info!("gh {} (cwd: {cwd})", args.join(" "));
    let output = new_command("gh")
        .current_dir(&cwd)
        .args(args)
        .output()
        .map_err(|e| format!("Failed to run gh: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::error!("gh {} failed: {}", args.join(" "), stderr.trim());
        return Err(format!("gh {} failed: {}", args.join(" "), stderr.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    log::debug!("gh {} succeeded ({} bytes)", args.join(" "), stdout.len());
    Ok(stdout)
}

#[tauri::command]
pub fn list_issues(repo_path: String) -> Result<Vec<GitHubIssue>, String> {
    log::info!("list_issues: repo_path={repo_path}");
    let owner_repo = get_owner_repo(&repo_path)?;
    let output = run_gh(
        &repo_path,
        &[
            "issue",
            "list",
            "-R",
            &owner_repo,
            "--state",
            "open",
            "--limit",
            "100",
            "--json",
            GH_JSON_FIELDS,
        ],
    )?;

    let raw: Vec<GhIssue> =
        serde_json::from_str(&output).map_err(|e| format!("Failed to parse gh output: {e}"))?;
    Ok(raw.into_iter().map(to_github_issue).collect())
}

#[tauri::command]
pub fn get_issue(repo_path: String, issue_number: u64) -> Result<GitHubIssue, String> {
    log::info!("get_issue: repo_path={repo_path}, issue_number={issue_number}");
    let owner_repo = get_owner_repo(&repo_path)?;
    let num_str = issue_number.to_string();
    let output = run_gh(
        &repo_path,
        &[
            "issue",
            "view",
            &num_str,
            "-R",
            &owner_repo,
            "--json",
            GH_JSON_FIELDS,
        ],
    )?;

    let raw: GhIssue =
        serde_json::from_str(&output).map_err(|e| format!("Failed to parse gh output: {e}"))?;
    Ok(to_github_issue(raw))
}

#[tauri::command]
pub fn create_issue(
    repo_path: String,
    title: String,
    body: String,
    labels: Vec<String>,
) -> Result<GitHubIssue, String> {
    log::info!("create_issue: repo_path={repo_path}, title={title}");
    let owner_repo = get_owner_repo(&repo_path)?;
    let mut args = vec![
        "issue",
        "create",
        "-R",
        &owner_repo,
        "--title",
        &title,
        "--body",
        &body,
    ];
    let labels_joined = labels.join(",");
    if !labels.is_empty() {
        args.push("--label");
        args.push(&labels_joined);
    }
    let output = run_gh(&repo_path, &args)?;

    // gh issue create outputs the URL. We need to extract the issue number and fetch it.
    let url = output.trim();
    let number: u64 = url
        .rsplit('/')
        .next()
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| format!("Cannot parse issue number from URL: {url}"))?;

    get_issue(repo_path, number)
}

#[tauri::command]
pub fn update_issue(
    repo_path: String,
    issue_number: u64,
    title: String,
    body: String,
    labels: Vec<String>,
) -> Result<GitHubIssue, String> {
    log::info!("update_issue: repo_path={repo_path}, issue_number={issue_number}");
    let owner_repo = get_owner_repo(&repo_path)?;
    let num_str = issue_number.to_string();
    let mut args = vec![
        "issue",
        "edit",
        &num_str,
        "-R",
        &owner_repo,
        "--title",
        &title,
        "--body",
        &body,
    ];
    // gh issue edit --add-label replaces; to set exact labels we clear then add
    let labels_joined = labels.join(",");
    if !labels.is_empty() {
        args.push("--add-label");
        args.push(&labels_joined);
    }
    run_gh(&repo_path, &args)?;

    get_issue(repo_path, issue_number)
}

#[tauri::command]
pub fn assign_issue(repo_path: String, issue_number: u64) -> Result<(), String> {
    let owner_repo = get_owner_repo(&repo_path)?;
    let num_str = issue_number.to_string();
    run_gh(
        &repo_path,
        &[
            "issue",
            "edit",
            &num_str,
            "-R",
            &owner_repo,
            "--add-assignee",
            "@me",
        ],
    )?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrInfo {
    pub number: u64,
    pub url: String,
    pub state: String,
}

#[derive(Debug, Deserialize)]
struct GhPrStatus {
    number: u64,
    url: String,
    state: String,
    #[serde(rename = "mergedAt")]
    merged_at: Option<String>,
}

#[tauri::command]
pub fn create_pr(
    repo_path: String,
    branch: String,
    base_branch: String,
    title: String,
    body: String,
) -> Result<PrInfo, String> {
    log::info!("create_pr: repo_path={repo_path}, branch={branch}, base={base_branch}");
    let owner_repo = get_owner_repo(&repo_path)?;
    let output = run_gh(
        &repo_path,
        &[
            "pr",
            "create",
            "-R",
            &owner_repo,
            "--head",
            &branch,
            "--base",
            &base_branch,
            "--title",
            &title,
            "--body",
            &body,
        ],
    )?;

    // gh pr create outputs the PR URL. Extract number and fetch details.
    let url = output.trim().to_string();
    let number: u64 = url
        .rsplit('/')
        .next()
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| format!("Cannot parse PR number from URL: {url}"))?;

    Ok(PrInfo {
        number,
        url,
        state: "OPEN".to_string(),
    })
}

#[tauri::command]
pub fn check_pr_status(repo_path: String, branch: String) -> Result<PrInfo, String> {
    log::info!("check_pr_status: repo_path={repo_path}, branch={branch}");
    let owner_repo = get_owner_repo(&repo_path)?;
    let output = run_gh(
        &repo_path,
        &[
            "pr",
            "view",
            &branch,
            "-R",
            &owner_repo,
            "--json",
            "number,state,url,mergedAt",
        ],
    )?;

    let raw: GhPrStatus =
        serde_json::from_str(&output).map_err(|e| format!("Failed to parse gh pr output: {e}"))?;

    let state = if raw.merged_at.is_some() {
        "MERGED".to_string()
    } else {
        raw.state
    };

    Ok(PrInfo {
        number: raw.number,
        url: raw.url,
        state,
    })
}

#[tauri::command]
pub fn close_issue(repo_path: String, issue_number: u64) -> Result<(), String> {
    log::info!("close_issue: repo_path={repo_path}, issue_number={issue_number}");
    let owner_repo = get_owner_repo(&repo_path)?;
    let num_str = issue_number.to_string();
    run_gh(&repo_path, &["issue", "close", &num_str, "-R", &owner_repo])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_ssh_url() {
        assert_eq!(
            parse_owner_repo("git@github.com:owner/repo.git").unwrap(),
            "owner/repo"
        );
    }

    #[test]
    fn test_parse_ssh_url_no_dotgit() {
        assert_eq!(
            parse_owner_repo("git@github.com:owner/repo").unwrap(),
            "owner/repo"
        );
    }

    #[test]
    fn test_parse_https_url() {
        assert_eq!(
            parse_owner_repo("https://github.com/owner/repo.git").unwrap(),
            "owner/repo"
        );
    }

    #[test]
    fn test_parse_https_url_no_dotgit() {
        assert_eq!(
            parse_owner_repo("https://github.com/owner/repo").unwrap(),
            "owner/repo"
        );
    }

    #[test]
    fn test_parse_non_github_url() {
        assert!(parse_owner_repo("git@gitlab.com:owner/repo.git").is_err());
    }
}
