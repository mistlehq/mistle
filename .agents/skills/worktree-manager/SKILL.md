---
name: worktree-manager
description: Create and bootstrap git worktrees for this repository when the user asks Codex to manage isolated branches or parallel working directories for a task.
---

# Worktree Manager

Use this skill when the user asks to create or bootstrap a git worktree for this repository.

## Behavior

1. When deriving a default worktree path, anchor it to the shared repository's primary worktree rather than the current checkout name.
   - Resolve the shared git directory with `git rev-parse --git-common-dir`.
   - Derive the primary worktree root from that shared git directory.
   - Prefer sibling worktree directories using the pattern `<primary-repo-parent>/<primary-repo-name>-<slug>`.
2. Default the base ref to `main` unless the user explicitly asks for another base.
3. Derive a safe kebab-case slug from the user task when they do not provide a branch or path.
4. After creation, bootstrap the new worktree by running:
   - `pnpm install`
   - `pnpm config:init:dev`
5. If `CODEX_THREAD_ID` is available, prepare a two-line resume handoff for the new worktree:
   - `cd <worktree-path>`
   - `codex resume -C . <thread-id>`
6. Verify state after creation with `git worktree list --porcelain`.

## Create

When creating a worktree:

1. Resolve:
   - repo root
   - worktree path
   - branch name
   - base ref
2. Run `scripts/create-worktree.sh` with those four arguments in that order.
3. Fail fast if the destination path already exists unless the user explicitly asked to reuse or replace it.
4. Report:
   - worktree path
   - branch name
   - base ref
   - bootstrap commands that ran
   - the two-line resume handoff for the new worktree
   - whether the resume command was copied to the clipboard
   - whether a new Terminal window was launched
   - verification output summary

## Notes

- Prefer using the helper scripts rather than recreating the workflow inline in shell commands.
- If the user only asks a conceptual question about worktrees, answer directly and do not run the scripts.
