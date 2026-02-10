use std::process::Command;

/// Create a Command with proper PATH for macOS GUI apps.
///
/// GUI apps on macOS don't inherit the shell PATH, so git/gh commands may fail
/// with "No such file or directory". This function adds common binary locations
/// to the PATH before running the command.
pub fn new_command(program: &str) -> Command {
    let mut cmd = Command::new(program);

    #[cfg(target_os = "macos")]
    {
        // Add common binary locations for Homebrew, system tools, etc.
        let path_additions = [
            "/opt/homebrew/bin", // Apple Silicon Homebrew
            "/usr/local/bin",    // Intel Homebrew
            "/usr/bin",          // System binaries
            "/bin",              // Core binaries
        ];

        if let Ok(existing_path) = std::env::var("PATH") {
            let mut paths: Vec<String> = path_additions
                .iter()
                .map(std::string::ToString::to_string)
                .collect();
            paths.push(existing_path);
            cmd.env("PATH", paths.join(":"));
        } else {
            cmd.env("PATH", path_additions.join(":"));
        }
    }

    cmd
}
