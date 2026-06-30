---
name: pr-review-followthrough
description: Shepherd an existing ready GitHub PR through CI and reviewer feedback until it is acceptable for merge. Use when the user asks to watch PR checks, respond to review comments, handle `pr-review`, push fixes, push back on reviewer findings, or iterate until no blocking findings remain.
---

# Pr Review Followthrough

Use this only after a PR exists and is ready for review. If the PR does not exist or is still draft, use `github-pr-authoring` first.

## Resolve State

1. Resolve the PR from the current branch or user-provided PR number/URL.
2. Record the current head SHA, merge state, review decision, comments, reviews, and checks from live GitHub state.
3. Use thread-aware review data for inline comments and resolution state. Do not rely on flat PR comments alone when review threads matter.

## Main Loop

Repeat until the stop conditions are met:

1. Watch checks for the current head with `gh pr checks <number> --watch`.
2. If a check fails, inspect logs, fix the real issue, validate locally, commit, push, then continue the loop. Do not bypass hooks or hide CI failures.
3. After checks pass, refresh thread-aware review state. If there is no reviewer response for the current head, post `pr-review` once and wait.
4. Classify each current-head reviewer finding:
   - Accept when the finding is real, in scope, and fixable without changing intended behavior.
   - Reject when the finding is incorrect, speculative, broad, behavior-changing, or outside the PR scope.
   - Clarify when the finding is too ambiguous to fix safely.
5. For accepted findings, make the smallest fix, run focused validation, then run `pnpm validate:changed --base origin/main --head HEAD` before pushing.
6. Commit and push accepted fixes after validation passes. Do not post `pr-review` after a push; the push triggers reviewer agents.
7. For rejected findings, reply with concise code-backed evidence, post `pr-review` because no push occurred, then continue the loop.
8. For clarification findings, ask the minimum concrete question and post `pr-review` only when the reviewer must reconsider without a push.

## Stop Conditions

Stop only when all are true:

- CI is green, skipped, or neutral as expected for the current head.
- There are no unresolved, non-outdated actionable review threads.
- The latest reviewer response for the current head says no blocking findings, acceptable for merge, or equivalent.
- The PR merge state is clean or blocked only by human approval/merge policy.

## Report

Report the PR URL, current head SHA, CI result, reviewer result, accepted fixes pushed, rejected findings with reasons, validation run, and any human-only blocker.
