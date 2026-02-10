use std::process::Command;

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
