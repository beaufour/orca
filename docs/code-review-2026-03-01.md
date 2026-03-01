# Rust Code Review — 2026-03-01

## BUGS

### 1. `find_worktree_in_bare()` has wrong parsing logic (agentdeck.rs:1256-1271)

Should use `parse_worktree_list()` instead of manual parsing.

### 2. `send_prompt_to_session()` timeout message is wrong (agentdeck.rs:1188-1191)

Uses 400 in calculation but delay is 300ms.

### 3. `scroll_tmux_pane()` silently swallows invalid direction (tmux.rs:86-90)

No validation on direction parameter.

### 4. `check_prerequisites` gives false positives (command.rs:26)

`output().is_ok()` only checks spawn, not exit status.

## DUPLICATED CODE

### 5. `expand_tilde()` vs `expand_home()` (command.rs vs git.rs)

Functionally identical. git.rs should use expand_tilde.

### 6. `detect_default_branch()` vs `get_default_branch_inner()` (git.rs)

Nearly identical logic, should be unified.

### 7. `normalize_url()` duplicated (claude_remote.rs, opencode_remote.rs)

### 8. `parse_sse_event()` duplicated (claude_remote.rs, opencode_remote.rs)

### 9. `build_client()` largely duplicated (claude_remote.rs, opencode_remote.rs)

### 10. SSE stream processing duplicated (claude_remote.rs, opencode_remote.rs)

7-10: Extract shared remote helpers module.

### 11. `find_worktree_in_bare()` duplicates `parse_worktree_list()` (agentdeck.rs)

Fixed by #1.

## ANTI-PATTERNS

### 12. `String` as the sole error type — low priority, skip for now.

### 13. Opening a new DB connection per call in OrcaDb (orca_db.rs)

Consider persistent connection.

### 14. Migration checks run on every query (orca_db.rs:76-78)

Should run once at init.

### 15. `open_db()` writable for agent-deck DB — acknowledged workaround, skip.

### 16. `thread::sleep` in `paste_to_tmux_pane` — minor, skip.

### 17. Blocking `thread::sleep` in `send_prompt_to_session` — low priority, skip.

## MISSING TESTS

### 18. pty.rs — zero tests (skip, needs integration test infra)

### 19. tmux.rs — add tests for `is_waiting_for_input`

### 20. agentdeck.rs — add tests for `parse_session_id`, `find_worktree_in_bare` (after refactor), `create_scripted_worktree` component substitution

### 21. parse_sse_event — add tests

### 22. Component substitution in `create_scripted_worktree` — add tests

## SECURITY / CORRECTNESS

### 23. Auth tokens over IPC — design issue, skip for now.

### 24. `set_var("PATH")` — already called early, add comment.

### 25. No HTTP timeout — add timeout to reqwest clients.

### 26. SSE streams no cancellation — add abort handles.

## MINOR

- `_timestamp` field naming
- `&PathBuf` → `&Path` in read_tail_lines/read_head_lines
- Trailing slash bug in github URL parsing
