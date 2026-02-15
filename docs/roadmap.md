# Orca Roadmap

**Vision**: Make the user incredibly efficient at producing software, with minimal oversight.

**Date**: 2025-02-15

---

## Current State

Orca is a desktop GUI (Tauri + React) for managing parallel Claude Code sessions across repos and git worktrees, built on agent-deck. Today it provides:

- **Session management**: Create, rename, move, dismiss, remove sessions across groups
- **Attention dashboard**: Color-coded status indicators (needs_input, error, running, idle, stale) with a consolidated "Needs Action" view
- **Git worktree lifecycle**: Create worktrees, view diffs, merge/rebase branches, create PRs, clean up
- **Integrated terminal**: xterm.js + tmux PTY bridge for full terminal access per session
- **GitHub integration**: List/create/edit/close issues, create PRs, link issues to sessions
- **Diff viewer**: Syntax-highlighted diffs with line-range commenting and comment export as Claude prompts
- **Keyboard navigation**: Vim-style `j`/`k`, group switching with `0`-`9`, search with `/`
- **Monorepo support**: Custom worktree scripts, component pickers, bare repo support

The user still does significant manual work: deciding what to work on, creating sessions, writing prompts, reviewing every diff, handling every attention item, and manually merging results. The roadmap below is organized around eliminating that manual work layer by layer.

---

## Phase 1: Visibility & Feedback Loops

Before automating decisions, give the user much better data about what's happening.

### 1.1 Session Activity Timeline

A per-session timeline view showing a chronological feed of meaningful events:
- Tools used (file writes, bash commands, searches)
- Files created/modified/deleted
- Errors encountered and how they were resolved
- Commits made
- Cost incurred (tokens in/out)

This replaces "what is this session doing?" with a scannable feed instead of reading raw terminal output.

### 1.2 Cost Tracking

Parse Claude Code JSONL logs to extract token usage per session. Display:
- Per-session cost (running total and rate)
- Per-group cost aggregation
- Budget alerts (configurable thresholds)
- Historical cost per completed task

This is table-stakes for running many sessions in parallel. Without it the user can't reason about spend.

### 1.3 Session Output Diffs (Auto-Generated)

When a session reaches idle/complete state, automatically compute the git diff of its worktree against the base branch and surface it in the session card. No need to click into the diff viewer for a quick scan. Show:
- Files changed count and net lines added/removed
- One-line summary of the change (from Claude's own summary)
- A "looks good" / "needs review" indicator based on heuristics (test pass, lint clean, no TODOs introduced)

### 1.4 Test & Lint Status Per Session

After a session completes its work, automatically run the project's test/lint suite in the session's worktree (configurable per group). Display pass/fail status on the session card. This is the most basic quality gate and dramatically reduces the review burden.

Configuration:
- Per-group "check command" (e.g., `npm run check`, `cargo test`)
- Run automatically on idle, or on-demand
- Results cached and displayed as badge on session card

### 1.5 Notifications

System notifications (macOS/Linux) when:
- A session needs input
- A session encounters an error
- A session completes successfully
- Tests fail on a completed session

The user shouldn't need Orca in the foreground to know when to act.

---

## Phase 2: Smarter Session Management

Reduce the manual work of creating, prompting, and triaging sessions.

### 2.1 Session Templates

Predefined prompt templates per group for common tasks:
- "Fix issue #{number}: {title}\n\n{body}"
- "Add tests for {file}"
- "Refactor {component} to use {pattern}"
- Custom user-defined templates with variables

One-click session creation from a template. Combined with the GitHub issues list, this means: see issue, click "start", session is created with worktree + prompt derived from the issue.

### 2.2 Issue-to-Session Pipeline

Automate the full flow from GitHub issue to working session:
1. User selects issue(s) from the issue list
2. Orca creates worktree(s) with branch names derived from issue numbers/titles
3. Orca composes a prompt from the issue title + body + labels + any linked context
4. Session starts working immediately

Batch mode: select multiple issues, create all sessions in parallel with one click.

### 2.3 Auto-Triage Attention Items

Not all "needs input" events require human judgment. Many are:
- Permission prompts for safe operations (file writes within the worktree, running tests)
- Plan approval where the plan is straightforward
- Questions with obvious answers from project context

Add configurable auto-response rules:
- Auto-approve file operations within the session's worktree
- Auto-approve bash commands matching a whitelist (test, lint, build commands)
- Auto-dismiss "stale" sessions after configurable timeout
- Custom rules per group

This is opt-in and conservative by default. The goal is to let the user focus only on decisions that actually require human judgment.

### 2.4 Session Restart with Context

When a session errors out or gets stuck, offer a "retry" action that:
- Creates a new session in the same worktree
- Includes the original prompt + a summary of what went wrong
- Preserves any work already committed

Instead of manually diagnosing and re-prompting, one click restarts with learned context.

### 2.5 Session Priorities & Ordering

Allow marking sessions as high/medium/low priority. Sort the attention dashboard by priority. This matters when running 10+ parallel sessions - the user needs to know which attention items to handle first.

---

## Phase 3: Automated Quality & Review

Move from "user reviews everything" to "user reviews what the system can't verify automatically."

### 3.1 Automated Code Review via Claude

When a session completes and its diff is ready, automatically run a review pass using a separate Claude instance:
- Check for security issues, bugs, style violations
- Verify the change actually addresses the original prompt/issue
- Flag anything suspicious for human review
- Produce a structured review with per-file comments

Display the review inline in the diff viewer. The user reads a pre-digested review instead of raw diffs.

### 3.2 CI Integration

Connect to the project's CI system (GitHub Actions, etc.):
- After a PR is created, monitor CI status
- Surface CI results on the session card
- If CI fails, optionally create a follow-up session to fix the failures
- Auto-merge PRs that pass CI + review (with user opt-in)

### 3.3 Multi-Session Conflict Detection

When multiple sessions are working on the same codebase, detect potential conflicts early:
- Track which files each session is modifying
- Warn when two sessions touch the same file
- Suggest merge order to minimize conflicts
- After one session merges, auto-rebase others and flag any conflicts

### 3.4 Merge Queue

A merge queue that processes completed sessions in optimal order:
- Prioritize sessions with passing tests and clean reviews
- Automatically rebase on main before merge
- Detect and surface merge conflicts before they become problems
- Batch compatible merges (non-overlapping file sets)

The user approves sessions for the queue, and the queue handles the rest.

---

## Phase 4: Orchestration

Move from "user creates and manages each session" to "user states goals, system decomposes and executes."

### 4.1 Task Decomposition Engine

Given a high-level goal (feature description, set of issues, or a design doc), automatically decompose into parallelizable tasks:
- Analyze the codebase to understand module boundaries
- Break the goal into independent workstreams (one per worktree/session)
- Identify dependencies between tasks (what must be done sequentially)
- Generate a DAG of tasks with prompts for each

Example: "Implement user authentication with OAuth" becomes:
1. Add OAuth library + configuration (independent)
2. Create user model + migration (independent)
3. Implement OAuth callback handler (depends on 1, 2)
4. Add login/logout UI (depends on 3)
5. Write integration tests (depends on 3, 4)

### 4.2 Task DAG Execution

Execute the task DAG with automatic orchestration:
- Start all independent tasks in parallel
- When a task completes (passes quality gates), merge its results
- Rebase dependent tasks on the merged main and start them
- Handle failures by retrying or escalating to the user
- Visualize the DAG as a live graph showing status of each node

The user watches a pipeline execute rather than managing individual sessions.

### 4.3 Context Sharing Between Sessions

Sessions working on related tasks benefit from shared context:
- When task A completes and task B depends on it, include A's summary + key decisions in B's prompt
- Maintain a shared "project context" document that all sessions can reference
- When one session discovers something unexpected (API quirk, undocumented behavior), propagate that knowledge to related sessions

### 4.4 Adaptive Prompting

Learn from session outcomes to improve prompts over time:
- Track which prompt patterns lead to successful completions vs. errors
- Track which repos/languages/frameworks have common pitfalls
- Automatically include relevant guidance in prompts (e.g., "this project uses Tailwind, not plain CSS")
- Per-group prompt preambles derived from `CLAUDE.md` and past session analysis

### 4.5 Goal Tracking Dashboard

A high-level view showing progress toward goals rather than individual sessions:
- "Authentication feature: 3/5 tasks complete, 1 in review, 1 blocked"
- Estimated completion based on task DAG and current velocity
- Critical path highlighting (which tasks are blocking progress)
- Link from goal view down to individual sessions

---

## Phase 5: Autonomy & Self-Improvement

The system handles entire development workflows end-to-end with human approval only at key checkpoints.

### 5.1 Continuous Development Loop

Define ongoing objectives, not just one-shot tasks:
- "Keep the test suite passing and coverage above 80%"
- "Address all P0 bugs within 24 hours of filing"
- "Process the backlog: work through issues labeled 'ready' in priority order"

Orca monitors the objective, creates sessions as needed, processes quality gates, and requests human approval only for merges that touch critical paths.

### 5.2 Codebase Health Monitor

Continuous background analysis:
- Track test coverage trends
- Monitor for new lint warnings or type errors on main
- Detect dependency vulnerabilities (dependabot/renovate integration)
- Automatically create fix sessions for regressions

### 5.3 Release Automation

When a set of merged changes constitutes a release:
- Generate changelog from session summaries and PR descriptions
- Run full test suite
- Create release PR with changelog
- After approval, tag and publish

### 5.4 Knowledge Base

Build a persistent knowledge base from session history:
- What architectural decisions were made and why
- Common pitfalls per module/component
- Which approaches worked vs. failed for similar tasks
- Use this knowledge to improve future session prompts and reviews

### 5.5 Multi-Repo Orchestration

For organizations with multiple repos:
- Coordinate changes that span repos (API changes + client updates)
- Manage version bumps and dependency updates across repos
- Shared context and conventions across the organization's projects

---

## Implementation Priority

The phases are roughly ordered by value and dependency, but within phases, items can be built incrementally. A suggested implementation order that balances impact with feasibility:

**Near-term (high impact, moderate effort)**:
1. 1.4 Test & lint status per session
2. 1.2 Cost tracking
3. 2.2 Issue-to-session pipeline
4. 2.3 Auto-triage attention items
5. 1.5 Notifications

**Medium-term (high impact, significant effort)**:
6. 3.1 Automated code review
7. 3.3 Multi-session conflict detection
8. 3.4 Merge queue
9. 2.1 Session templates
10. 1.1 Session activity timeline

**Longer-term (transformative, requires foundation from above)**:
11. 4.1 Task decomposition engine
12. 4.2 Task DAG execution
13. 4.3 Context sharing between sessions
14. 4.5 Goal tracking dashboard
15. 5.1 Continuous development loop

---

## Design Principles

These should guide implementation decisions across all phases:

1. **Conservative automation**: Every automated action should be auditable and reversible. Start with suggestions, graduate to auto-actions as trust is established.

2. **Progressive disclosure**: The UI should show the right level of detail for the user's current focus. Session cards show summaries; drill down for timelines; drill down further for raw terminal.

3. **Graceful degradation**: Features should work independently. If CI integration isn't configured, the merge queue still works using local test results. If cost tracking can't parse logs, sessions still function.

4. **Codebase-agnostic**: Nothing should assume a specific language, framework, or project structure. Configuration per group handles the differences.

5. **Speed over perfection**: For autonomous operation, it's better to attempt a task quickly and iterate than to spend time planning the perfect approach. The quality gates catch mistakes; the retry mechanism handles failures.

6. **Human at the boundary**: Automation handles the interior of the workflow (decomposition, execution, testing, review). Humans approve at boundaries (goal definition, merge to main, releases).
