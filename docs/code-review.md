# TypeScript Code Review — March 2026

Full review of all TypeScript code in the Orca frontend codebase.

## Summary

The codebase is well-structured with good use of TypeScript, TanStack Query, and custom hooks. The main themes for improvement are: **reducing duplication** (especially between the two workflow hooks), **fixing an event listener leak**, and **improving type safety**.

| Severity | Count | Key Items                                                                                               |
| -------- | ----- | ------------------------------------------------------------------------------------------------------- |
| Critical | 1     | Event listener memory leak                                                                              |
| High     | 4     | Code duplication (remote handler, CreateSessionParams, labelStyle), side effects in select              |
| Medium   | 5     | Inconsistent query keys, non-null assertion, duplicate groups query, module-level state, deprecated API |
| Low      | 3     | Inconsistent Modal usage, unsafe casts, missing .catch()                                                |

## Findings

### 1. CRITICAL: Event Listener Memory Leak in Conflict Resolution

**Files:** `useWorktreeActions.ts:272-286`, `usePrWorkflowActions.ts:349-363`

Both `conflictSessionMutation` handlers call `listen()` inside the mutation function, but the returned unlisten promises are never cleaned up. Every invocation leaks two permanent event listeners.

### 2. HIGH: Duplicated `onCreateRemoteSession` Handler

**File:** `App.tsx:530-569` and `App.tsx:613-652`

Two near-identical ~40-line blocks for creating remote sessions are passed to `TodoList` and `AddSessionBar`.

### 3. HIGH: `CreateSessionParams` Defined 5 Times

**Files:** `useSessionCreation.ts`, `SessionList.tsx`, `AddSessionBar.tsx`, `TodoList.tsx`, `MainSessionGhost.tsx`

Each has slightly different optional fields. Should be a single exported type.

### 4. HIGH: Side Effects in `useQuery.select` Callback

**File:** `usePrWorkflowActions.ts:178-205`

PR status polling query uses `select` to fire state changes (`setPrState`, `setPrInfo`) and `invoke` calls. `select` should be pure.

### 5. HIGH: `labelStyle` Function Duplicated

**Files:** `TodoList.tsx:45-54` and `TodoCard.tsx:30-40`

Identical function. Should be in `utils.ts`.

### 6. MEDIUM: Inconsistent Query Key Usage

**File:** `usePrWorkflowActions.ts`

Some queries use raw arrays instead of the centralized `queryKeys` helper: `["worktreeStatus", ...]`, `["prStatus", ...]`, `["sessions"]`, `["worktrees", ...]`.

### 7. MEDIUM: Non-null Assertion on Possibly Null Value

**File:** `App.tsx:495`

`effectiveSession!` could crash at runtime if the value is null.

### 8. MEDIUM: Module-level Mutable State

**File:** `DiffViewer.tsx:24`

`let nextCommentId = 1` at module scope leaks across component instances.

### 9. MEDIUM: Deprecated `navigator.platform` Usage

**File:** `DiffViewer.tsx:367,423`

`navigator.platform` is deprecated.

### 10. MEDIUM: Duplicate Groups Query

**Files:** `App.tsx` and `Sidebar.tsx`

Both independently query groups with different `refetchInterval` configs.

### 11. LOW: `AppSettingsModal` and `CreatePrModal` Don't Use `Modal` Component

These manually implement the modal backdrop instead of using the shared `Modal` component.

### 12. LOW: Unsafe Type Casts in MessageStream

**File:** `MessageStream.tsx:80-85`

Multiple `as unknown as` casts bypass type safety for SSE event data.

### 13. LOW: Fire-and-forget `invoke` Calls Without `.catch()`

Several `invoke("open_in_terminal", ...)` calls silently swallow errors.
