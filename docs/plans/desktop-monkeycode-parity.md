# Desktop interaction parity with MonkeyCode

Reference: MonkeyCode desktop at commit `5e083386456a142b1439dc5fa75f200370ff6014`. Its Rust/Tauri process hosts a React UI; the user interactions are primarily implemented in `desktop/ui-next`. This document records behavior to reproduce in SaCode with original code and assets. MonkeyCode is AGPL-3.0, so its source and visual assets are not copied into SaCode.

| Area | Interaction granularity in MonkeyCode | SaCode status |
| --- | --- | --- |
| Workbench | Project/session tree, search, task status, ordering, session menu, several conversations at once | Project/session tree, search, local ordering, task status and session menu exist. Nested right/down splits, drag resize, maximize/restore, position swap and close are implemented. Split geometry and pane assignments persist per workspace. Local archive and completion-based unread markers are implemented; cross-device archive and unread sync are pending. |
| New task | Select a directory, enter prompt, select model/skill/thinking, add attachments | Workspace, prompt, model, skill and project-file context selection exist. Thinking capability is displayed from model configuration. Uploading an external attachment and per-task thinking selection are pending. |
| Conversation | Timeline, tool/approval/question cards, history, outline, plan and subagent detail | Timeline and outline exist. The composer keeps independent drafts in each pane. Pending approval cards are shown and resolved for the correct task, including another pane's task. Question response, plan and subagent cards need another pass. |
| Composer | Send/stop, queue editing and ordering, attachments, mode/model/context controls | Send/stop, mode/model/skill/backend and project-file context controls exist. While a turn runs, the desktop can queue messages, edit/reorder/remove them and submit the next one after completion; failed submissions remain for retry. The queue persists locally per workspace. Sends interrupted by shutdown require explicit retry after checking the conversation. External attachments and context meter are pending. |
| Files | Browse workspace, search/expand folders, preview a file, inspect changed files and diffs | Tree, search, bounded authenticated text preview and actual diff rendering are implemented. Editing files in this panel is pending. |
| Terminal | Persistent shell with input/output and multiple tabs | Native PTY with multiple sessions, input/output and close is implemented in Tauri. The output area accepts direct key input including arrows and Ctrl+C, supports paste, and resizes the PTY with the visible panel. The Web-only preview reports that a desktop session is required. Full VT emulation is still missing. |
| Preview | Choose an app URL and reload | Per-workspace HTTP(S) URL and reload are implemented. Automatic dev-server discovery is pending. |
| Settings | General, models, MCP, skills and app settings with save/reset behavior | SaCode already has multiple settings sections. MCP and skills management needs parity review and CRUD completion. |

## Scope exclusions

MonkeyCode account membership, cloud task/project sync, vendor telemetry and other vendor-operated services are outside SaCode's local desktop scope. Browser extension, WSL and mascot features are also outside this workbench pass.

Temporary sessions and to-do groups are explicitly excluded from parity scope at the user's request.

## Implementation notes

- The SaCode shell remains Tauri 2 with a TypeScript WebView. Native process and file operations belong in Rust; UI state and interaction belong in the WebView.
- `/workspace/file` is read-only, requires daemon authentication, rejects paths outside the active workspace, and limits previews to 100 KiB of UTF-8 text.
- Native terminals are bound to the active workspace and are closed when switching workspaces or stopping the daemon.
- The existing checkout's untracked `split-tree.ts` and `split-slots.ts` drafts were not used by this branch; the shipped nested split behavior is in `split-layout.ts`.

## Gap audit (2026-09-28)

The current implementation is in the isolated `codex/desktop-monkeycode-parity` worktree. The original checkout has separate uncommitted changes; it has not received this branch's desktop work.

### P0: workflow blockers

1. **Question flow.** Approval cards now render in their task's pane and allow/deny calls use that task ID. `interaction.ask` still returns `pending_question`, but the daemon has no question-answer/resume endpoint. A question response UI requires that backend path before it can complete a paused task.
2. **Conversation replay.** The desktop conversation API stores turn prompt/status/output. The UI combines those turns with a process-local event timeline. After restart, prior tool steps, approvals, plans and subagent activity are not replayed as rich cards.
3. **MCP and skill management.** Settings offers model/provider controls and skill selection elsewhere, but no MCP or skills management sections with add/edit/remove, validation and save behavior.

### P1: interaction and data gaps

4. **Task column and multi-project navigation.** SaCode's sidebar builds one group from the active workspace. Loading tasks from multiple projects into slots and richer row status/actions remain open. SaCode archive is localStorage-only; unread status is process-local.
5. **New task and attachments.** SaCode supports recent folders, a workspace file picker, model and one skill. It lacks external file/image upload, drag/drop and paste, task draft recovery and per-task thinking override.
6. **Send queue lifetime.** SaCode's queue supports edit/reorder/remove/retry and serial dispatch, and persists locally per workspace. Interrupted sends are restored with an uncertain-delivery error and require explicit retry. Cross-device sync and queue pause/resume controls are pending.
7. **Files and changes.** SaCode's file list comes from `WorkspaceScanner` (1,000 files, depth 5) rather than lazy directory listing. Preview is text-only and capped at 100 KiB. The file tree and preview are vertically stacked; MonkeyCode uses a resizable tree/preview pair with richer preview types and repository-level change badges.
8. **Terminal.** The UI now sends direct keyboard input, Ctrl+C, paste and resize to the Rust PTY. The readable text transcript strips ANSI control sequences, so cursor movement, full-screen terminal apps and terminal search remain missing.

### P2: polish and verification

9. **Layout gestures.** SaCode can split, resize, maximize and swap through menus, and restores its split tree and pane assignments per workspace. Drag-to-swap and dragging tasks into a specific pane are not wired.
10. **Preview.** SaCode embeds a manually entered HTTP(S) URL. Automatic dev-server discovery and the richer browser preview controls are missing.
11. **Visual QA.** Type checks, unit tests and build pass; a wide native Tauri window has not yet been visually compared page by page against MonkeyCode. Pixel-level alignment is unverified.
