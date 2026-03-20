---
name: worktree-manager
description: Create and bootstrap git worktrees for this repository when the user asks Codex to manage isolated branches or parallel working directories for a task.
---

# Worktree Manager

Use this skill when the user asks to create or bootstrap a git worktree for this repository.

If the user only asks a conceptual question about worktrees, answer directly and do not run scripts.

For creation requests:

1. Resolve `repo_root`, `worktree_path`, `branch_name`, and `base_ref`.
   - If the user does not provide a base ref, use the latest `origin/main`.
   - If the user explicitly asks for `main`, normalize it to the latest `origin/main`.
   - If the user does not provide a branch or path, derive a safe kebab-case slug from the task.
   - Prefer sibling worktree directories using `<repo-parent>/<repo-name>-<slug>`.
2. Fail fast if the destination path already exists unless the user explicitly asked to reuse or replace it.
3. Run `scripts/create-worktree.sh <repo_root> <worktree_path> <branch_name> <base_ref>`.
   - Prefer the helper script over recreating the workflow inline in shell commands.
4. Verify the result with `git worktree list --porcelain`.
5. Report:
   - worktree path
   - branch name
   - base ref
   - bootstrap steps: `pnpm install`, `pnpm config:init:dev`
   - resume command
   - whether the resume command was copied to the clipboard
