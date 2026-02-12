use serde::Serialize;
use std::path::PathBuf;
use std::process::Command;

#[derive(Serialize)]
pub struct PrerequisiteStatus {
    pub name: String,
    pub found: bool,
    pub required: bool,
}

/// Check whether external binaries that Orca depends on are available.
#[tauri::command]
pub fn check_prerequisites() -> Vec<PrerequisiteStatus> {
    let checks: &[(&str, &[&str], bool)] = &[
        ("agent-deck", &["version"], true),
        ("tmux", &["-V"], true),
        ("git", &["--version"], false),
        ("gh", &["--version"], false),
    ];

    checks
        .iter()
        .map(|(name, args, required)| {
            let found = Command::new(name).args(*args).output().is_ok();
            PrerequisiteStatus {
                name: name.to_string(),
                found,
                required: *required,
            }
        })
        .collect()
}

/// Expand ~ in paths to the home directory.
pub fn expand_tilde(path: &str) -> PathBuf {
    if let Some(stripped) = path.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(stripped);
        }
    }
    PathBuf::from(path)
}

/// Inherit the user's shell PATH for macOS GUI apps.
///
/// GUI apps on macOS don't inherit the shell PATH, so commands like
/// git/gh/agent-deck/tmux can't be found. This runs a login shell to
/// get the user's configured PATH and sets it on the process.
/// Call once at startup.
pub fn init_path() {
    #[cfg(target_os = "macos")]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        let output = Command::new(&shell)
            .args(["-l", "-c", "echo $PATH"])
            .output();

        match output {
            Ok(out) if out.status.success() => {
                let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !path.is_empty() {
                    std::env::set_var("PATH", &path);
                }
            }
            _ => {
                log::warn!("Failed to get PATH from {shell}, commands may not be found");
            }
        }
    }
}

/// Create a Command. Assumes `init_path()` has been called at startup.
pub fn new_command(program: &str) -> Command {
    Command::new(program)
}

/// Run a command in a directory, returning stdout on success or an error on non-zero exit.
pub fn run_cmd(program: &str, cwd: &str, args: &[&str]) -> Result<String, String> {
    let expanded = expand_tilde(cwd);
    let cwd_str = expanded.to_string_lossy();
    log::info!("{program} {} (cwd: {cwd_str})", args.join(" "));

    let output = new_command(program)
        .current_dir(cwd_str.as_ref())
        .args(args)
        .output()
        .map_err(|e| format!("Failed to run {program}: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::error!(
            "{program} {} failed (exit {}): {}",
            args.join(" "),
            output.status,
            stderr.trim()
        );
        return Err(format!(
            "{program} {} failed: {}",
            args.join(" "),
            stderr.trim()
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    log::debug!("{program} {} succeeded", args.join(" "));
    Ok(stdout)
}

/// Run a command in a directory, returning (stdout, success) without treating non-zero exit as error.
pub fn run_cmd_status(program: &str, cwd: &str, args: &[&str]) -> Result<(String, bool), String> {
    let expanded = expand_tilde(cwd);
    let cwd_str = expanded.to_string_lossy();
    log::info!("{program} {} (cwd: {cwd_str})", args.join(" "));

    let output = new_command(program)
        .current_dir(cwd_str.as_ref())
        .args(args)
        .output()
        .map_err(|e| format!("Failed to run {program}: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    Ok((stdout, output.status.success()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expand_tilde_with_home_prefix() {
        let result = expand_tilde("~/foo/bar");
        let home = dirs::home_dir().unwrap();
        assert_eq!(result, home.join("foo/bar"));
    }

    #[test]
    fn expand_tilde_absolute_path_unchanged() {
        let result = expand_tilde("/usr/local/bin");
        assert_eq!(result, PathBuf::from("/usr/local/bin"));
    }

    #[test]
    fn expand_tilde_relative_path_unchanged() {
        let result = expand_tilde("relative/path");
        assert_eq!(result, PathBuf::from("relative/path"));
    }

    #[test]
    fn expand_tilde_only_tilde_slash() {
        let result = expand_tilde("~/");
        let home = dirs::home_dir().unwrap();
        assert_eq!(result, home.join(""));
    }

    #[test]
    fn expand_tilde_bare_tilde_unchanged() {
        // Just "~" without "/" should NOT expand
        let result = expand_tilde("~");
        assert_eq!(result, PathBuf::from("~"));
    }
}
