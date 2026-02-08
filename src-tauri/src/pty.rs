use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tauri::State;

struct PtySession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn portable_pty::MasterPty + Send>,
    child: Box<dyn portable_pty::Child + Send>,
    shutdown: Arc<AtomicBool>,
}

/// Cleanly shut down a PtySession.
///
/// IMPORTANT: PtySession must NEVER be dropped without calling this first.
/// If a PtySession is dropped while its child process is still alive (e.g.
/// by HashMap::insert replacing an existing entry), portable-pty's
/// UnixMasterWriter::Drop will write `\n` + EOF (Ctrl-D) to the PTY master.
/// The still-alive child (`tmux attach-session`) reads that `\n` from its
/// stdin and forwards it to the tmux pane, injecting a visible newline.
///
/// This function prevents that by killing the child and waiting for it to
/// fully exit before the PtySession is dropped. Once the child is dead, its
/// PTY slave fd is closed, so the `\n` written by the writer's Drop goes
/// into a dead kernel buffer that nobody reads.
///
/// See `docs/bug-newlines-research.md` for the full investigation.
fn shutdown_session(mut session: PtySession) {
    session.shutdown.store(true, Ordering::Relaxed);
    let _ = session.child.kill();
    let _ = session.child.wait();
    // session drops here: writer Drop sends \n + EOF, but child is dead
    // so the bytes go into a dead PTY buffer that nobody reads
}

#[derive(Default)]
pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<String, PtySession>>>,
}

#[tauri::command]
pub fn attach_pty(
    state: State<'_, PtyManager>,
    session_id: String,
    tmux_session: String,
    cols: u16,
    rows: u16,
    on_output: Channel<String>,
) -> Result<(), String> {
    let pty_system = native_pty_system();

    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    // Set window-size to "latest" so our attach doesn't shrink the session
    // when another client (e.g. a regular terminal) is also attached
    let _ = std::process::Command::new("tmux")
        .args(["set-option", "-t", &tmux_session, "window-size", "latest"])
        .output();

    let mut cmd = CommandBuilder::new("tmux");
    cmd.env("TERM", "xterm-256color");
    cmd.args(["attach-session", "-t", &tmux_session]);

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn tmux attach: {}", e))?;

    // We can drop the slave after spawning
    drop(pair.slave);

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to get PTY writer: {}", e))?;

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to get PTY reader: {}", e))?;

    let shutdown = Arc::new(AtomicBool::new(false));
    let shutdown_clone = shutdown.clone();
    let sid = session_id.clone();

    // Spawn reader thread — streams PTY output via Channel
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            if shutdown_clone.load(Ordering::Relaxed) {
                break;
            }
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let encoded = BASE64.encode(&buf[..n]);
                    if on_output.send(encoded).is_err() {
                        break;
                    }
                }
                Err(e) => {
                    if shutdown_clone.load(Ordering::Relaxed) {
                        break;
                    }
                    log::error!("PTY read error for {}: {}", sid, e);
                    break;
                }
            }
        }
    });

    let session = PtySession {
        writer,
        master: pair.master,
        child,
        shutdown,
    };

    // CRITICAL: Clean up any existing session before inserting the new one.
    // Without this, HashMap::insert silently drops the old PtySession, which
    // triggers portable-pty's UnixMasterWriter::Drop to write \n + EOF into
    // the PTY while the old tmux attach child is still alive — injecting a
    // newline into the tmux pane on every open. This commonly happens due to
    // React strict mode double-firing effects in development. See
    // shutdown_session() docs and docs/bug-newlines-research.md for details.
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    if let Some(old) = sessions.remove(&session_id) {
        // Drop lock before blocking on shutdown to avoid holding it during wait()
        drop(sessions);
        shutdown_session(old);
        // Re-acquire for insert
        sessions = state
            .sessions
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
    }
    sessions.insert(session_id, session);

    Ok(())
}

#[tauri::command]
pub fn write_pty(state: State<'_, PtyManager>, session_id: String, data: String) -> Result<(), String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;

    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| format!("No PTY session: {}", session_id))?;

    let bytes = BASE64
        .decode(&data)
        .map_err(|e| format!("Base64 decode error: {}", e))?;

    session
        .writer
        .write_all(&bytes)
        .map_err(|e| format!("PTY write error: {}", e))?;

    session
        .writer
        .flush()
        .map_err(|e| format!("PTY flush error: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn resize_pty(
    state: State<'_, PtyManager>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;

    let session = sessions
        .get(&session_id)
        .ok_or_else(|| format!("No PTY session: {}", session_id))?;

    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("PTY resize error: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn close_pty(state: State<'_, PtyManager>, session_id: String) -> Result<(), String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;

    if let Some(session) = sessions.remove(&session_id) {
        drop(sessions);
        shutdown_session(session);
    }

    Ok(())
}
