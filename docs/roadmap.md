# Orca Roadmap

**Vision**: Make the user incredibly efficient at producing software, with minimal oversight.

**Date**: 2026-02-15

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

## Landscape & Positioning

The multi-agent coding orchestration space is emerging fast. Understanding where Orca fits — and where it deliberately diverges — is important for avoiding wasted effort and for sharpening what makes Orca valuable.

### Gas Town (Steve Yegge, Jan 2026)

[Gas Town](https://steve-yegge.medium.com/welcome-to-gas-town-4f25ee16dd04) is the most ambitious entry in this space: a multi-agent orchestration framework that manages 20-30 parallel Claude Code sessions through a hierarchy of AI-played roles (Mayor, Witness, Deacon, Polecats, etc.). Its core innovation is the MEOW stack — persistent, crash-recoverable workflow chains stored as "Beads" (issues in git). Key properties:

- **AI-as-orchestrator**: The control plane itself is Claude Code instances prompted into roles. The Mayor dispatches work, the Witness unblocks stuck agents, the Deacon monitors health. This is powerful but expensive ($100-200/hr in API fees) and fragile (the orchestrator can hallucinate, get stuck, or need its own supervisor).
- **MEOW stack**: Workflows survive agent crashes because state is persisted as Beads in git. This is genuinely novel and the most important idea to learn from.
- **Chaos-tolerant philosophy**: "Some bugs get fixed 2 or 3 times. Other fixes get lost." Gas Town optimizes for throughput, accepting waste. Quality is achieved through volume and iteration, not gates.
- **Target audience**: Stage 7-8 developers already hand-managing 10+ agents. Explicitly not for beginners.

### Where Orca Diverges

Orca and Gas Town attack the same problem — a developer running many parallel AI sessions — but with fundamentally different philosophies:

| | Gas Town | Orca |
|---|---|---|
| **Control plane** | AI agents (Claude Code instances in roles) | Deterministic code (Rust/TypeScript) |
| **Interface** | tmux (Yegge says "someone should build a GUI") | Native desktop GUI (Tauri) |
| **Quality model** | Chaos + volume ("fish fall from the barrel") | Deterministic gates (test, lint, review, CI) |
| **Cost model** | Uncontrolled ($100-200/hr), no tracking | Cost tracking + budget alerts from Phase 1 |
| **Target user** | Stage 7-8 (already managing 10+ agents) | Stage 4-8 (scales with the user) |
| **Failure mode** | Retry until it works | Detect, report, escalate |
| **Persistence** | MEOW stack (Beads in git) | SQLite DB (Orca's own state) |

The core bet: **a deterministic control plane with AI used only for the actual coding work** will be more reliable, cheaper, and accessible than an AI-all-the-way-down approach. Gas Town proves the problem space is real. Orca's job is to solve it with good software engineering.

### What We Should Learn From Gas Town

1. **Persistent workflow state**: The MEOW stack's key insight is that multi-step workflows must survive agent crashes and context window limits. Orca's task DAG (Phase 4.2) must persist state in SQLite, not just in memory. Every workflow step should be resumable.
2. **Patrol patterns**: Gas Town's Deacon runs continuous background health checks on agents. Orca's auto-triage (Phase 2.3) should be a continuous polling loop, not just reactive to user clicks.
3. **The Convoy concept**: Gas Town wraps related tasks into "Convoys" — trackable delivery units with a lifecycle. Orca's Goal Tracking Dashboard (Phase 4.5) should adopt this: a goal is a named, tracked unit of work that progresses through decomposition → execution → quality gates → merge → done.
4. **Graceful degradation of autonomy**: Gas Town's best design property is that every worker can function independently or in groups. Orca should maintain this — every phase should work standalone, and higher phases should enhance rather than require lower phases.

### What We Should NOT Copy

1. **AI-as-orchestrator**: Using Claude Code to manage Claude Code is recursive, expensive, and fragile. Deterministic code is better for control planes.
2. **No cost controls**: "Do not use Gas Town if you care about money" is a non-starter for most users.
3. **Stage 7+ barrier to entry**: Orca should make the transition from 1 to 20+ sessions smooth, not assume the user is already there.
4. **Chaos tolerance as a feature**: Accepting that work gets lost or duplicated is fine for a prototype; Orca should track every task to completion or explicit abandonment.

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

Implementation as a **continuous patrol loop** (inspired by Gas Town's Deacon pattern, but deterministic): Orca polls all session states every few seconds, applies triage rules, and auto-responds where rules match. This is not an AI agent watching other agents — it's a simple Rust polling loop checking JSONL log state against a rule set.

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

This is the phase most comparable to Gas Town's core functionality. The critical difference: Orca's orchestration is deterministic Rust code managing a persistent task DAG, not AI agents managing other AI agents. The AI is used for decomposition (turning a goal into tasks) and execution (doing the actual coding), but scheduling, dependency tracking, merge ordering, and failure handling are all deterministic.

### 4.1 Task Decomposition Engine

Given a high-level goal (feature description, set of issues, or a design doc), use Claude to decompose into parallelizable tasks:
- Analyze the codebase to understand module boundaries
- Break the goal into independent workstreams (one per worktree/session)
- Identify dependencies between tasks (what must be done sequentially)
- Generate a DAG of tasks with prompts for each

The user reviews and edits the proposed DAG before execution starts. This is a "human at the boundary" checkpoint — AI proposes, human approves, deterministic code executes.

Example: "Implement user authentication with OAuth" becomes:
1. Add OAuth library + configuration (independent)
2. Create user model + migration (independent)
3. Implement OAuth callback handler (depends on 1, 2)
4. Add login/logout UI (depends on 3)
5. Write integration tests (depends on 3, 4)

### 4.2 Task DAG Execution with Persistent State

Execute the task DAG with deterministic orchestration. All state persisted in Orca's SQLite DB so workflows survive crashes, restarts, and context window limits. (This is the lesson from Gas Town's MEOW stack — workflow state must outlive any single agent session.)

Each task in the DAG has a persistent lifecycle:
- `pending` → `ready` (dependencies met) → `running` (session active) → `quality_check` (tests/lint/review) → `merged` or `failed`
- State transitions are deterministic code, not AI judgment
- On crash or restart, Orca reads the DAG from SQLite and resumes from the last known state

Orchestration logic:
- Start all `ready` tasks in parallel (create worktree + session)
- When a task passes quality gates, merge its results via the merge queue (Phase 3.4)
- Rebase dependent tasks on the merged main and transition them to `ready`
- On failure: retry once with context from the failure, then escalate to user
- Visualize the DAG as a live graph showing status of each node

### 4.3 Context Sharing Between Sessions

Sessions working on related tasks benefit from shared context:
- When task A completes and task B depends on it, include A's summary + key decisions in B's prompt
- Maintain a shared "project context" document that all sessions can reference
- When one session discovers something unexpected (API quirk, undocumented behavior), propagate that knowledge to related sessions

This is context propagation, not AI-to-AI communication. The orchestrator (deterministic code) reads session summaries from JSONL logs and injects them into downstream prompts. No agents talking to agents.

### 4.4 Adaptive Prompting

Learn from session outcomes to improve prompts over time:
- Track which prompt patterns lead to successful completions vs. errors
- Track which repos/languages/frameworks have common pitfalls
- Automatically include relevant guidance in prompts (e.g., "this project uses Tailwind, not plain CSS")
- Per-group prompt preambles derived from `CLAUDE.md` and past session analysis

### 4.5 Goal Tracking Dashboard

A high-level view showing progress toward goals (cf. Gas Town's "Convoy" concept) rather than individual sessions:
- "Authentication feature: 3/5 tasks complete, 1 in review, 1 blocked"
- Estimated completion based on task DAG and current velocity
- Critical path highlighting (which tasks are blocking progress)
- Link from goal view down to individual sessions

A goal is a named, tracked delivery unit with a full lifecycle: created → decomposed → executing → quality gates → merged → done. Unlike Gas Town's Convoys, this lifecycle is managed by deterministic code with clear state transitions, not by an AI "Mayor."

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

1. **Deterministic control plane**: Orchestration, scheduling, state management, and quality gates are deterministic code (Rust/TypeScript), not AI. AI is used for two things: decomposing goals into tasks, and doing the actual coding work inside sessions. Everything between those two endpoints is reliable, auditable, and free. This is the core architectural bet that distinguishes Orca from Gas Town's AI-all-the-way-down approach.

2. **Conservative automation**: Every automated action should be auditable and reversible. Start with suggestions, graduate to auto-actions as trust is established.

3. **Progressive disclosure**: The UI should show the right level of detail for the user's current focus. Session cards show summaries; drill down for timelines; drill down further for raw terminal.

4. **Graceful degradation**: Features should work independently. If CI integration isn't configured, the merge queue still works using local test results. If cost tracking can't parse logs, sessions still function. Every phase works standalone; higher phases enhance but don't require lower phases.

5. **Codebase-agnostic**: Nothing should assume a specific language, framework, or project structure. Configuration per group handles the differences.

6. **Speed over perfection**: For autonomous operation, it's better to attempt a task quickly and iterate than to spend time planning the perfect approach. The quality gates catch mistakes; the retry mechanism handles failures.

7. **Human at the boundary**: Automation handles the interior of the workflow (decomposition, execution, testing, review). Humans approve at boundaries (goal definition, merge to main, releases).

8. **Persistent workflow state**: All workflow state (task DAGs, session outcomes, quality gate results) is persisted in SQLite. Workflows survive crashes, restarts, and machine reboots. No work is lost because an agent ran out of context window.
