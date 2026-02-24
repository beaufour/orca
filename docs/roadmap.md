# Orca Roadmap

**Vision**: Make the user incredibly efficient at producing software, with minimal oversight.

**Date**: 2026-02-24

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

The user still does significant manual work: deciding what to work on, creating sessions, writing prompts, reviewing every diff, handling every attention item, and manually merging results. The roadmap is organized around replacing that manual work with an autonomous loop — and only escalating to the user when the system genuinely can't handle something.

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
| **Quality model** | Chaos + volume ("fish fall from the barrel") | Multi-agent verification + deterministic gates |
| **Cost model** | Uncontrolled ($100-200/hr), no tracking | Cost quotas with hard enforcement |
| **Target user** | Stage 7-8 (already managing 10+ agents) | Stage 4-8 (scales with the user) |
| **Failure mode** | Retry until it works | Verify, fix, or escalate |
| **Persistence** | MEOW stack (Beads in git) | SQLite DB (Orca's own state) |

The core bet: **a deterministic control plane with AI used for coding and verification** will be more reliable, cheaper, and accessible than an AI-all-the-way-down approach. Gas Town proves the problem space is real. Orca's job is to solve it with good software engineering.

### What We Should Learn From Gas Town

1. **Persistent workflow state**: The MEOW stack's key insight is that multi-step workflows must survive agent crashes and context window limits. Orca's task state must persist in SQLite, not just in memory. Every workflow step should be resumable.
2. **Patrol patterns**: Gas Town's Deacon runs continuous background health checks on agents. Orca's patrol loop should continuously monitor session state and act on it without waiting for user input.
3. **The Convoy concept**: Gas Town wraps related tasks into "Convoys" — trackable delivery units with a lifecycle. Orca should adopt this: a goal is a named, tracked unit of work that progresses through decomposition → execution → quality gates → merge → done.
4. **Graceful degradation of autonomy**: Gas Town's best design property is that every worker can function independently or in groups. Orca should maintain this — every phase should work standalone, and higher phases should enhance rather than require lower phases.

### What We Should NOT Copy

1. **AI-as-orchestrator**: Using Claude Code to manage Claude Code is recursive, expensive, and fragile. Deterministic code is better for control planes.
2. **No cost controls**: "Do not use Gas Town if you care about money" is a non-starter for most users.
3. **Stage 7+ barrier to entry**: Orca should make the transition from 1 to 20+ sessions smooth, not assume the user is already there.
4. **Chaos tolerance as a feature**: Accepting that work gets lost or duplicated is fine for a prototype; Orca should track every task to completion or explicit abandonment.

---

## Phase 1: Autonomous Quality Loop

The minimum viable pipeline for a session to go from work → verify → merge without human intervention. This is the core of Orca — everything else feeds into or builds on this loop.

The loop: **validate requirements → do the work → run quality gates → review → check test sufficiency → merge or escalate.**

### 1.1 Requirements Validation

Before a session starts coding, ensure the requirements are clear enough to produce correct output. Cheap to check, expensive to skip.

- Parse the issue/prompt for ambiguities, undefined terms, missing acceptance criteria
- Cross-reference against the codebase (does the referenced API/component/file exist?)
- If requirements are unclear, pause and ask the user for clarification BEFORE spending tokens on coding
- If requirements reference other issues or PRs, pull that context into the prompt automatically

This is a lightweight Claude call (not a full coding session) that gates session start. Better to spend 30 seconds validating than 10 minutes coding the wrong thing.

### 1.2 Quality Gates

After a session completes its work, automatically run the project's quality checks in the session's worktree. This is the foundation the entire autonomous loop depends on.

Configuration per group:
- **Check commands**: e.g., `npm run check`, `cargo test`, `make lint` — one or more commands that must all pass
- **Trigger**: automatically on session idle, or on-demand
- **Result**: pass/fail stored in Orca's DB, displayed as badge on session card

If checks fail, the session is not eligible for merge. The loop can either retry (send the failure output back to the session to fix) or escalate to the user.

### 1.3 Multi-Agent Review

When a session passes quality gates, run a separate review step using a different Claude instance (or a different prompt profile). The reviewer has a different perspective than the author — this is the multi-agent check on correctness.

The reviewer evaluates:
- **Correctness**: Does the change actually implement what the requirements asked for?
- **Bugs and security**: Any obvious issues, injection vectors, race conditions?
- **Scope**: Did the session stay within scope or make unrelated changes?
- **Style**: Does it follow the project's conventions?

The reviewer produces a structured verdict: **approve**, **request changes** (with specifics), or **escalate** (needs human judgment). If "request changes," the original session gets the feedback and iterates. If "approve," the change proceeds to merge.

This is deliberately NOT the same agent reviewing its own work. The value comes from the second perspective.

### 1.4 Test Sufficiency

A quality gate specifically for test coverage. After the session's work passes tests, check whether the tests are actually adequate for the change:

- Does the diff include new code paths that aren't covered by tests?
- Are there edge cases in the new logic that should have tests?
- Did the session modify existing tests in ways that reduce coverage?

If test coverage is insufficient, automatically spawn a follow-up session in the same worktree to add the missing tests. The follow-up session's prompt includes the original diff and the specific coverage gaps identified.

This runs as part of the review step (1.3) or as a separate gate — either way, the change doesn't merge until tests are adequate.

### 1.5 Auto-Merge

When all gates pass (quality checks green, review approved, tests sufficient), merge automatically. No human approval needed for changes that pass the full pipeline.

- Rebase on main before merge
- Run quality checks again post-rebase (in case main moved)
- If merge conflicts arise, attempt auto-resolution; if that fails, escalate
- Clean up the worktree and branch after successful merge
- Record the merge in Orca's DB (which session, which issue, what changed, cost)

The user configures the auto-merge policy per group:
- **Full auto**: merge anything that passes all gates (default for trusted pipelines)
- **Auto with notification**: merge and notify the user after the fact
- **Approval required**: queue for user approval (for critical repos or early trust-building)

### 1.6 Cost Quotas

Hard budget enforcement, not just tracking. Running many sessions in parallel can burn money fast — the system needs guardrails.

- **Per-session budget**: maximum spend before the session is paused and the user is asked whether to continue. Parsed from Claude Code JSONL logs (token counts × model pricing).
- **Per-group budget**: aggregate limit across all sessions in a group. When the group hits its budget, no new sessions start and running sessions are allowed to complete their current step but not start new work.
- **Hourly/daily rate limits**: cap the spend rate, not just the total. Prevents a burst of parallel sessions from draining the budget in minutes.
- **Budget alerts**: notify the user at configurable thresholds (50%, 80%, 100%).

Cost data is parsed from JSONL logs and stored in Orca's DB. The UI shows cost per session, per group, and total — but the primary function is enforcement, not display.

### 1.7 Escalation-Only Attention

The autonomous loop handles the happy path. The user's attention is only needed for:

- **Requirements clarification** (1.1): the prompt is ambiguous
- **Review escalation** (1.3): the reviewer can't decide — needs human judgment
- **Merge conflicts** (1.5): auto-resolution failed
- **Budget exceeded** (1.6): a session or group hit its cost limit
- **Repeated failures**: a session has failed quality gates or review multiple times and the retry loop isn't converging

Everything else — permission prompts, plan approvals, straightforward errors — is handled by the patrol loop automatically. The user's dashboard shows only genuine escalations, not routine status updates.

Notifications (system notifications, optional Slack/Telegram integration) fire only for escalations, not for routine completions.

---

## Phase 2: Session Pipeline

Automate the flow of work into the autonomous loop. The user should be able to point Orca at a set of issues and walk away.

### 2.1 Issue-to-Session Pipeline

Automate the full flow from GitHub issue to working session:
1. User selects issue(s) from the issue list
2. Orca creates worktree(s) with branch names derived from issue numbers/titles
3. Orca composes a prompt from the issue title + body + labels + any linked context
4. Requirements validation (Phase 1.1) runs
5. Session starts working immediately

Batch mode: select multiple issues, create all sessions in parallel with one click.

### 2.2 Session Templates

Predefined prompt templates per group for common tasks:
- "Fix issue #{number}: {title}\n\n{body}"
- "Add tests for {file}"
- "Refactor {component} to use {pattern}"
- Custom user-defined templates with variables

Combined with the issue pipeline, this means: select issues, pick a template, sessions are created with worktrees + prompts derived from the issues.

### 2.3 Patrol Loop

A continuous background process (Rust polling loop, not an AI agent) that monitors all session states and takes action without waiting for user input. Inspired by Gas Town's Deacon pattern, but deterministic.

The patrol loop handles:
- **Auto-triage attention items**: auto-approve file operations within the worktree, auto-approve whitelisted bash commands (test, lint, build), auto-dismiss stale sessions
- **Session health**: detect stuck sessions (no progress for configurable timeout), restart with context from the failure
- **Pipeline progression**: when a session goes idle, trigger quality gates; when gates pass, trigger review; when review passes, trigger merge
- **Cost enforcement**: pause sessions approaching budget limits

Configurable per group. Conservative defaults — the user opts into more automation as trust builds.

### 2.4 Session Restart with Context

When a session errors out or gets stuck (detected by the patrol loop or by the user):
- Create a new session in the same worktree
- Include the original prompt + a summary of what went wrong + any work already committed
- Preserve all committed work

The patrol loop does this automatically after configurable retry limits. The user can also trigger it manually.

---

## Phase 3: Scaling Parallel Work

What happens when 10+ sessions are working on the same codebase simultaneously. Conflict detection and merge ordering become critical.

### 3.1 Multi-Session Conflict Detection

Track which files each session is modifying (by watching git status in each worktree):
- Warn when two sessions touch the same file
- Suggest merge order to minimize conflicts (merge the smaller/simpler change first)
- After one session merges, automatically rebase others and re-run quality gates
- Flag irreconcilable conflicts for user attention

### 3.2 Merge Queue

A merge queue that processes completed sessions in optimal order:
- Prioritize sessions with passing gates and clean reviews
- Automatically rebase on main before merge
- Detect and surface merge conflicts before they become problems
- Batch compatible merges (non-overlapping file sets) for throughput
- Serialize conflicting merges (overlapping file sets) for safety

The queue operates autonomously. The user can inspect it, reorder it, or pause it, but the default is fully automatic.

### 3.3 Session Priorities

When running many parallel sessions, the system needs to know what matters most:
- Priority levels (high/medium/low) set per session or inherited from issue labels
- Higher-priority sessions get reviewed and merged first
- Budget allocation respects priority — high-priority work isn't starved by low-priority sessions burning the budget
- Escalations are sorted by priority in the attention dashboard

---

## Phase 4: Orchestration

Move from "user creates and manages each session" to "user states goals, system decomposes and executes."

This is the phase most comparable to Gas Town's core functionality. The critical difference: Orca's orchestration is deterministic Rust code managing a persistent task DAG, not AI agents managing other AI agents. The AI is used for decomposition (turning a goal into tasks) and execution (doing the actual coding), but scheduling, dependency tracking, merge ordering, and failure handling are all deterministic.

### 4.1 Task Decomposition

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

### 4.2 DAG Execution with Persistent State

Execute the task DAG with deterministic orchestration. All state persisted in Orca's SQLite DB so workflows survive crashes, restarts, and context window limits. (Lesson from Gas Town's MEOW stack — workflow state must outlive any single agent session.)

Each task in the DAG has a persistent lifecycle:
- `pending` → `ready` (dependencies met) → `running` (session active) → `quality_check` (Phase 1 loop) → `merged` or `failed`
- State transitions are deterministic code, not AI judgment
- On crash or restart, Orca reads the DAG from SQLite and resumes from the last known state

Orchestration logic:
- Start all `ready` tasks in parallel (create worktree + session)
- Each task goes through the full Phase 1 autonomous loop (quality gates → review → merge)
- When a task merges, rebase dependent tasks and transition them to `ready`
- On failure: retry once with context from the failure, then escalate to user
- Visualize the DAG as a live graph showing status of each node

### 4.3 Context Sharing

Sessions working on related tasks benefit from shared context:
- When task A completes and task B depends on it, include A's summary + key decisions in B's prompt
- Maintain a shared "project context" document that all sessions can reference
- When one session discovers something unexpected (API quirk, undocumented behavior), propagate that knowledge to related sessions

This is context propagation, not AI-to-AI communication. The orchestrator (deterministic code) reads session summaries from JSONL logs and injects them into downstream prompts. No agents talking to agents.

### 4.4 Goal Tracking

A high-level view showing progress toward goals (cf. Gas Town's "Convoy" concept) rather than individual sessions:
- "Authentication feature: 3/5 tasks complete, 1 in review, 1 blocked"
- Estimated completion based on task DAG and current velocity
- Critical path highlighting (which tasks are blocking progress)
- Link from goal view down to individual sessions

A goal is a named, tracked delivery unit with a full lifecycle: created → decomposed → executing → quality gates → merged → done. Unlike Gas Town's Convoys, this lifecycle is managed by deterministic code with clear state transitions, not by an AI "Mayor."

---

## Phase 5: Continuous Autonomy

The system handles entire development workflows end-to-end with human approval only at key checkpoints.

### 5.1 Continuous Development Loop

Define ongoing objectives, not just one-shot tasks:
- "Keep the test suite passing and coverage above 80%"
- "Address all P0 bugs within 24 hours of filing"
- "Process the backlog: work through issues labeled 'ready' in priority order"

Orca monitors the objective, creates sessions as needed, processes them through the autonomous loop, and requests human approval only for merges that touch critical paths.

### 5.2 Codebase Health Monitor

Continuous background analysis:
- Track test coverage trends
- Monitor for new lint warnings or type errors on main
- Detect dependency vulnerabilities (dependabot/renovate integration)
- Automatically create fix sessions for regressions — these go through the full Phase 1 loop like any other session

### 5.3 Adaptive Prompting

Learn from session outcomes to improve prompts over time:
- Track which prompt patterns lead to successful completions vs. errors
- Track which repos/languages/frameworks have common pitfalls
- Automatically include relevant guidance in prompts (e.g., "this project uses Tailwind, not plain CSS")
- Per-group prompt preambles derived from `CLAUDE.md` and past session analysis

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

## Observability

These features support the autonomous loop by giving the user visibility when they want it — for debugging, auditing, or building trust. They are not the primary interface; the primary interface is the escalation dashboard (1.7).

### Session Activity Timeline

A per-session timeline of meaningful events: tools used, files changed, errors, commits, cost. Useful for understanding what a session did after the fact, especially when reviewing an escalation or investigating a failure.

### Cost Dashboard

Aggregate view of cost per session, per group, and total. Historical cost per completed task. Spend rate over time. This supports the cost quota system (1.6) but is also useful for understanding ROI.

### Session Output Diffs

When a session completes, auto-compute the git diff against base branch and display on the session card. Files changed, net lines, one-line summary. Useful for quick scanning without opening the full diff viewer.

---

## Implementation Priority

Phase 1 is the foundation — everything else depends on the autonomous loop working. Within Phase 1, the order is driven by the pipeline sequence:

**Phase 1 (build in order — each step depends on the previous)**:
1. 1.2 Quality gates (tests/lint) — the foundation
2. 1.6 Cost quotas — essential before running many sessions
3. 1.3 Multi-agent review — enables auto-merge
4. 1.5 Auto-merge — the payoff of the above three
5. 1.4 Test sufficiency — refinement of the review step
6. 1.1 Requirements validation — prevents wasted work
7. 1.7 Escalation-only attention — the UI for the autonomous loop

**Phase 2 (can be built incrementally alongside Phase 1)**:
8. 2.1 Issue-to-session pipeline
9. 2.3 Patrol loop
10. 2.2 Session templates
11. 2.4 Session restart with context

**Phase 3 (needed when running 5+ parallel sessions)**:
12. 3.1 Conflict detection
13. 3.2 Merge queue
14. 3.3 Session priorities

**Phase 4 (transformative, requires Phases 1-3)**:
15. 4.1 Task decomposition
16. 4.2 DAG execution
17. 4.3 Context sharing
18. 4.4 Goal tracking

---

## Design Principles

1. **Autonomous by default**: The system's job is to handle work end-to-end. The user's attention is a scarce resource — only consume it when the system genuinely can't proceed. Don't show dashboards; resolve issues. Don't notify about routine events; notify about genuine problems.

2. **Deterministic control plane**: Orchestration, scheduling, state management, and quality gates are deterministic code (Rust/TypeScript), not AI. AI is used for three things: validating requirements, doing the coding work, and reviewing the coding work. Everything between those endpoints is reliable, auditable, and free. This is the core architectural bet that distinguishes Orca from Gas Town's AI-all-the-way-down approach.

3. **Multi-agent verification**: The coder and the reviewer should be different agents with different prompts. A single agent can't reliably check its own work. The autonomous loop's credibility depends on genuine independent review.

4. **Graceful degradation**: Features should work independently. If multi-agent review isn't configured, quality gates still work. If cost quotas aren't set, sessions still run. Every phase works standalone; higher phases enhance but don't require lower phases.

5. **Persistent workflow state**: All workflow state (task lifecycles, session outcomes, quality gate results, cost data) is persisted in SQLite. Workflows survive crashes, restarts, and machine reboots. No work is lost because an agent ran out of context window.

6. **Codebase-agnostic**: Nothing should assume a specific language, framework, or project structure. Configuration per group handles the differences.

7. **Human at the boundary**: Humans define goals and approve the plan. The system handles everything between goal and merged result. If the system can't handle something, it escalates with full context — not a vague "needs input" flag, but a specific description of what's blocked and why.

8. **Progressive trust**: Start with more human checkpoints, earn automation. Auto-merge can require approval initially, then graduate to notify-after-merge, then full auto. The user dials in the autonomy level as they build confidence in the system.
