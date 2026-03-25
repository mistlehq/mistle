---
name: worktree-manager
description: Create and bootstrap git worktrees for this repository when the user asks Codex to manage isolated branches or parallel working directories for a task.
---

# Worktree Manager

Use this skill when the user asks to create or bootstrap a git worktree for this repository.

## Resolve Inputs

1. When deriving a default worktree path, anchor it to the shared repository's primary worktree rather than the current checkout name.
   - Resolve the shared git directory with `git rev-parse --git-common-dir`.
   - Derive the primary worktree root from that shared git directory.
   - Prefer sibling worktree directories using the pattern `<primary-repo-parent>/<primary-repo-name>-<slug>`.
2. Default the base ref to `main` unless the user explicitly asks for another base.
3. Derive a safe kebab-case slug from the user task when they do not provide a branch or path.

## Create

Use the helper script as the source of truth for creation, local-file sync, bootstrap, clipboard handling, and reporting.

1. Resolve:
   - repo root
   - worktree path
   - branch name
   - base ref
2. Run `.agents/skills/worktree-manager/scripts/create-worktree.sh` with those four arguments in that order.
3. The helper script copies these required developer-local files from the source worktree into the new worktree before bootstrap:
   - `.env.dev`
   - `integration-targets.provision.json`
   - `config/config.development.toml`
4. Treat a missing required local file as a bootstrap error, not something to regenerate or silently skip.
5. Treat the script output as the source of truth for what happened and report the key fields back to the user.
