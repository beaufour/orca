//! Claude Code hook integration.
//!
//! Orca installs three hooks in the user's `~/.claude/settings.json` —
//! `Notification`, `Stop`, and `UserPromptSubmit` — pointing at a tiny shim
//! script we write to `~/.orca/log_hook.sh`. The shim forwards each hook's
//! JSON payload to `~/.orca/events.jsonl`, one event per line. A background
//! tail loop reads that file and maintains an in-memory map of the latest
//! event per Claude session id, which `claude_logs::compute_attention` then
//! prefers over the older JSONL/tmux heuristics for live sessions.

use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;

/// The shim script body written to `~/.orca/log_hook.sh`. python3 ships with
/// every supported macOS/Linux dev environment, so we don't add a new runtime
/// dependency. The script reads the hook payload on stdin, compacts it to a
/// single JSON line, and appends it to the events log.
const SHIM_SCRIPT: &str = r#"#!/bin/sh
# Orca: forward Claude Code hook events to ~/.orca/events.jsonl as JSONL.
# Installed by Orca via Settings > Install Hooks.  Safe to delete; Orca will
# offer to reinstall the next time it starts.
mkdir -p "$HOME/.orca"
python3 -c '
import sys, json
try:
    data = json.load(sys.stdin)
    print(json.dumps(data, separators=(",", ":")))
except Exception:
    pass
' >> "$HOME/.orca/events.jsonl"
"#;

/// Hook events Orca installs. Order matters only for human-readable output.
const HOOK_SPECS: &[(&str, Option<&str>)] = &[
    ("Notification", Some("idle_prompt|permission_prompt")),
    ("Stop", None),
    ("UserPromptSubmit", None),
];

#[derive(Debug, Clone, Serialize)]
pub struct HookEvent {
    pub event: String,
    pub matcher: Option<String>,
    pub timestamp_secs: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct HookStatus {
    pub installed: bool,
    pub settings_path: String,
    pub shim_path: String,
    pub events_path: String,
    pub last_event_age_secs: Option<u64>,
    pub tracked_session_count: usize,
}

fn home() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"))
}

fn settings_path() -> PathBuf {
    home().join(".claude/settings.json")
}

fn shim_path() -> PathBuf {
    home().join(".orca/log_hook.sh")
}

fn events_path() -> PathBuf {
    home().join(".orca/events.jsonl")
}

/// In-process store: claude session id → latest hook event.
fn hook_store() -> &'static Mutex<HashMap<String, HookEvent>> {
    static STORE: OnceLock<Mutex<HashMap<String, HookEvent>>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Look up the most recent hook event for a Claude session.
pub fn latest_event_for(claude_session_id: &str) -> Option<HookEvent> {
    hook_store().lock().ok()?.get(claude_session_id).cloned()
}

/// True iff our shim path is referenced as a hook command in the user's
/// settings.json for at least one of the events we install.
fn detect_installed(settings: &serde_json::Value, shim: &str) -> bool {
    let Some(hooks) = settings.get("hooks").and_then(|v| v.as_object()) else {
        return false;
    };
    for (event, _) in HOOK_SPECS {
        let Some(arr) = hooks.get(*event).and_then(|v| v.as_array()) else {
            continue;
        };
        for entry in arr {
            let Some(inner) = entry.get("hooks").and_then(|v| v.as_array()) else {
                continue;
            };
            if inner
                .iter()
                .any(|h| h.get("command").and_then(|v| v.as_str()) == Some(shim))
            {
                return true;
            }
        }
    }
    false
}

fn read_settings() -> serde_json::Value {
    fs::read_to_string(settings_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}))
}

#[tauri::command]
pub fn get_claude_hooks_status() -> HookStatus {
    let settings = read_settings();
    let shim_str = shim_path().to_string_lossy().to_string();
    let installed = detect_installed(&settings, &shim_str) && shim_path().exists();

    let store = hook_store().lock();
    let (tracked, last_age) = match store {
        Ok(s) => {
            let now = SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let last_age = s
                .values()
                .map(|e| now.saturating_sub(e.timestamp_secs))
                .min();
            (s.len(), last_age)
        }
        Err(_) => (0, None),
    };

    HookStatus {
        installed,
        settings_path: settings_path().to_string_lossy().to_string(),
        shim_path: shim_str,
        events_path: events_path().to_string_lossy().to_string(),
        last_event_age_secs: last_age,
        tracked_session_count: tracked,
    }
}

/// Write the shim script and merge our hook entries into ~/.claude/settings.json.
/// Preserves any existing user hooks; only removes prior Orca entries (those
/// pointing at our shim path) before re-adding to keep things idempotent.
#[tauri::command]
pub fn install_claude_hooks() -> Result<HookStatus, String> {
    let shim = shim_path();
    if let Some(parent) = shim.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create {}: {e}", parent.display()))?;
    }
    fs::write(&shim, SHIM_SCRIPT).map_err(|e| format!("Failed to write shim: {e}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&shim)
            .map_err(|e| format!("stat shim: {e}"))?
            .permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&shim, perms).map_err(|e| format!("chmod shim: {e}"))?;
    }

    let settings_path = settings_path();
    if let Some(parent) = settings_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create {}: {e}", parent.display()))?;
    }
    let mut settings = read_settings();
    let shim_str = shim.to_string_lossy().to_string();

    merge_hooks(&mut settings, &shim_str);

    let pretty = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize settings.json: {e}"))?;
    fs::write(&settings_path, pretty + "\n")
        .map_err(|e| format!("Failed to write {}: {e}", settings_path.display()))?;

    log::info!(
        "Installed Claude hooks at {} (shim: {})",
        settings_path.display(),
        shim.display()
    );

    Ok(get_claude_hooks_status())
}

/// Remove only Orca's hook entries (those pointing at our shim) from settings.json.
/// Leaves user hooks intact and leaves the shim script on disk so a re-install
/// is idempotent.
#[tauri::command]
pub fn uninstall_claude_hooks() -> Result<HookStatus, String> {
    let settings_path = settings_path();
    if !settings_path.exists() {
        return Ok(get_claude_hooks_status());
    }
    let mut settings = read_settings();
    let shim_str = shim_path().to_string_lossy().to_string();

    strip_hooks(&mut settings, &shim_str);

    let pretty = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize settings.json: {e}"))?;
    fs::write(&settings_path, pretty + "\n")
        .map_err(|e| format!("Failed to write {}: {e}", settings_path.display()))?;

    log::info!("Uninstalled Claude hooks from {}", settings_path.display());
    Ok(get_claude_hooks_status())
}

/// Merge our hook entries into a settings.json object in place, preserving
/// any pre-existing user hooks for the same events.
fn merge_hooks(settings: &mut serde_json::Value, shim: &str) {
    if !settings.is_object() {
        *settings = serde_json::json!({});
    }
    let obj = settings.as_object_mut().expect("settings is object");
    let hooks = obj
        .entry("hooks".to_string())
        .or_insert_with(|| serde_json::json!({}));
    if !hooks.is_object() {
        *hooks = serde_json::json!({});
    }
    let hooks_obj = hooks.as_object_mut().expect("hooks is object");

    for (event, matcher) in HOOK_SPECS {
        let arr = hooks_obj
            .entry((*event).to_string())
            .or_insert_with(|| serde_json::json!([]));
        if !arr.is_array() {
            *arr = serde_json::json!([]);
        }
        let list = arr.as_array_mut().expect("hooks[event] is array");

        // Drop any prior Orca entries (matched by shim path) and any entries
        // whose only inner hook is our shim.
        list.retain(|entry| !entry_uses_shim(entry, shim));

        let mut new_entry = serde_json::json!({
            "hooks": [{ "type": "command", "command": shim }],
        });
        if let Some(m) = matcher {
            new_entry["matcher"] = serde_json::Value::String((*m).to_string());
        }
        list.push(new_entry);
    }
}

/// Remove any hook entries that reference our shim. Leaves other hook entries
/// for the same event untouched.
fn strip_hooks(settings: &mut serde_json::Value, shim: &str) {
    let Some(hooks) = settings.get_mut("hooks").and_then(|v| v.as_object_mut()) else {
        return;
    };
    for (event, _) in HOOK_SPECS {
        if let Some(arr) = hooks.get_mut(*event).and_then(|v| v.as_array_mut()) {
            arr.retain(|entry| !entry_uses_shim(entry, shim));
        }
    }
}

/// True iff this hook-list entry contains an inner hook whose command is our
/// shim path. We treat the entry as "ours" and drop it on uninstall/re-install.
fn entry_uses_shim(entry: &serde_json::Value, shim: &str) -> bool {
    entry
        .get("hooks")
        .and_then(|v| v.as_array())
        .map(|inner| {
            inner
                .iter()
                .any(|h| h.get("command").and_then(|v| v.as_str()) == Some(shim))
        })
        .unwrap_or(false)
}

/// Spawn the background tail loop that watches `~/.orca/events.jsonl` and
/// updates the in-process hook event store. Idempotent — safe to call once
/// at app startup.
pub fn start_tail_loop() {
    static STARTED: OnceLock<()> = OnceLock::new();
    if STARTED.set(()).is_err() {
        return;
    }
    std::thread::spawn(tail_loop);
}

fn tail_loop() {
    let path = events_path();
    let mut last_pos: u64 = 0;
    let mut last_inode: Option<u64> = None;

    log::info!("hook tail loop watching {}", path.display());

    loop {
        std::thread::sleep(std::time::Duration::from_millis(500));

        let Ok(metadata) = fs::metadata(&path) else {
            continue; // file doesn't exist yet
        };
        let size = metadata.len();
        let inode = current_inode(&metadata);

        // Detect rotation/truncation: rebuild from the start if the file
        // changed identity or shrank.
        if Some(inode) != last_inode || size < last_pos {
            last_pos = 0;
            last_inode = Some(inode);
        }

        if size <= last_pos {
            continue;
        }

        let Ok(file) = fs::File::open(&path) else {
            continue;
        };
        let mut reader = BufReader::new(file);
        if reader.seek(SeekFrom::Start(last_pos)).is_err() {
            continue;
        }

        let mut buf = String::new();
        loop {
            buf.clear();
            let n = match reader.read_line(&mut buf) {
                Ok(0) => break, // EOF
                Ok(n) => n,
                Err(_) => break,
            };
            // Don't consume a trailing partial line — it may still be being written.
            if !buf.ends_with('\n') {
                break;
            }
            process_event_line(&buf);
            last_pos += n as u64;
        }
    }
}

#[cfg(unix)]
fn current_inode(meta: &fs::Metadata) -> u64 {
    use std::os::unix::fs::MetadataExt;
    meta.ino()
}

#[cfg(not(unix))]
fn current_inode(_meta: &fs::Metadata) -> u64 {
    0
}

fn process_event_line(line: &str) {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return;
    }
    let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) else {
        log::warn!("hook tail: skipping malformed JSON line");
        return;
    };
    let Some(session_id) = val
        .get("session_id")
        .and_then(|v| v.as_str())
        .map(String::from)
    else {
        return;
    };
    let Some(event) = val
        .get("hook_event_name")
        .and_then(|v| v.as_str())
        .map(String::from)
    else {
        return;
    };
    // Notification payloads carry the matcher value (idle_prompt vs permission_prompt).
    let matcher = val
        .get("matcher_value")
        .or_else(|| val.get("matcher"))
        .and_then(|v| v.as_str())
        .map(String::from);
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let Ok(mut store) = hook_store().lock() else {
        return;
    };
    log::debug!("hook tail: session={session_id} event={event} matcher={matcher:?}");
    store.insert(
        session_id,
        HookEvent {
            event,
            matcher,
            timestamp_secs: now,
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn merge_into_empty_settings_creates_all_hook_events() {
        let mut s = json!({});
        merge_hooks(&mut s, "/tmp/shim.sh");

        let hooks = s.get("hooks").and_then(|v| v.as_object()).unwrap();
        for (event, _) in HOOK_SPECS {
            let arr = hooks.get(*event).and_then(|v| v.as_array()).unwrap();
            assert_eq!(arr.len(), 1, "expected one entry for {event}");
            assert!(entry_uses_shim(&arr[0], "/tmp/shim.sh"));
        }
    }

    #[test]
    fn merge_preserves_existing_user_hooks() {
        let mut s = json!({
            "hooks": {
                "Stop": [
                    { "hooks": [{ "type": "command", "command": "/usr/local/bin/user-script" }] }
                ]
            }
        });
        merge_hooks(&mut s, "/tmp/shim.sh");

        let stop = s["hooks"]["Stop"].as_array().unwrap();
        // User entry preserved + Orca entry appended
        assert_eq!(stop.len(), 2);
        assert!(stop
            .iter()
            .any(|e| e["hooks"][0]["command"] == "/usr/local/bin/user-script"));
        assert!(stop.iter().any(|e| entry_uses_shim(e, "/tmp/shim.sh")));
    }

    #[test]
    fn merge_is_idempotent() {
        let mut s = json!({});
        merge_hooks(&mut s, "/tmp/shim.sh");
        merge_hooks(&mut s, "/tmp/shim.sh");
        merge_hooks(&mut s, "/tmp/shim.sh");

        for (event, _) in HOOK_SPECS {
            let arr = s["hooks"][*event].as_array().unwrap();
            assert_eq!(arr.len(), 1, "duplicate Orca entries for {event}");
        }
    }

    #[test]
    fn merge_includes_matcher_for_notification() {
        let mut s = json!({});
        merge_hooks(&mut s, "/tmp/shim.sh");

        let n = s["hooks"]["Notification"].as_array().unwrap();
        assert_eq!(n[0]["matcher"], "idle_prompt|permission_prompt");

        // Stop has no matcher
        let stop = s["hooks"]["Stop"].as_array().unwrap();
        assert!(stop[0].get("matcher").is_none());
    }

    #[test]
    fn strip_removes_only_orca_entries() {
        let mut s = json!({});
        merge_hooks(&mut s, "/tmp/shim.sh");
        // Add a user hook alongside ours
        s["hooks"]["Stop"]
            .as_array_mut()
            .unwrap()
            .push(json!({ "hooks": [{ "type": "command", "command": "/usr/local/bin/foo" }] }));

        strip_hooks(&mut s, "/tmp/shim.sh");

        let stop = s["hooks"]["Stop"].as_array().unwrap();
        assert_eq!(stop.len(), 1);
        assert_eq!(stop[0]["hooks"][0]["command"], "/usr/local/bin/foo");

        for (event, _) in HOOK_SPECS {
            let arr = s["hooks"][*event].as_array().unwrap();
            assert!(
                !arr.iter().any(|e| entry_uses_shim(e, "/tmp/shim.sh")),
                "Orca entry survived strip for {event}"
            );
        }
    }

    #[test]
    fn detect_installed_returns_true_only_when_shim_referenced() {
        let mut s = json!({});
        assert!(!detect_installed(&s, "/tmp/shim.sh"));

        merge_hooks(&mut s, "/tmp/shim.sh");
        assert!(detect_installed(&s, "/tmp/shim.sh"));
        assert!(!detect_installed(&s, "/some/other/shim.sh"));
    }

    #[test]
    fn process_event_line_records_session_event() {
        // Use a unique session id so this test is independent of any state
        // from other tests sharing the global store.
        let sid = "test-process-line-aaaabbbb";
        let payload = format!(
            "{{\"session_id\":\"{sid}\",\"hook_event_name\":\"Notification\",\"matcher_value\":\"idle_prompt\"}}"
        );
        process_event_line(&payload);

        let ev = latest_event_for(sid).expect("event recorded");
        assert_eq!(ev.event, "Notification");
        assert_eq!(ev.matcher.as_deref(), Some("idle_prompt"));
    }

    #[test]
    fn process_event_line_ignores_malformed() {
        process_event_line("not json at all");
        process_event_line("{}"); // missing session_id
        process_event_line("{\"session_id\":\"x\"}"); // missing event name
                                                      // No panic == pass.
    }

    #[test]
    fn process_event_line_overwrites_with_latest() {
        let sid = "test-overwrite-ccccdddd";
        process_event_line(&format!(
            "{{\"session_id\":\"{sid}\",\"hook_event_name\":\"Stop\"}}"
        ));
        process_event_line(&format!(
            "{{\"session_id\":\"{sid}\",\"hook_event_name\":\"UserPromptSubmit\"}}"
        ));

        let ev = latest_event_for(sid).expect("event recorded");
        assert_eq!(ev.event, "UserPromptSubmit");
    }
}
