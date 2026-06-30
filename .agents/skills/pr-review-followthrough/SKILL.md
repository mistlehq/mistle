---
name: pr-review-followthrough
description: Shepherd an existing ready GitHub PR through CI and reviewer feedback until it is acceptable for merge. Use when the user asks to watch PR checks, respond to review comments, handle `pr-review`, push fixes, push back on reviewer findings, or iterate until no blocking findings remain.
---

# Pr Review Followthrough

Use this after a PR exists and is ready for review. If the PR does not exist or is still draft, use `github-pr-authoring` first.

## Outcome

Leave the PR acceptable for merge: checks are complete, no actionable reviewer findings remain, and any remaining blocker needs human approval or merge policy rather than code changes.

## Follow Through

Work from live GitHub state for the current head SHA, including checks, review decisions, reviews, comments, and review threads.

Wait for checks. If a check fails, inspect the logs, fix the real issue, validate locally, commit, and push. Do not bypass hooks or hide CI failures.

Handle reviewer findings by judgment:

- Accept real, in-scope findings and push the smallest validated fix.
- Reject incorrect, speculative, behavior-changing, or out-of-scope findings with concise code-backed evidence.
- Ask a concrete clarification question when a finding is too ambiguous to fix safely.

Before pushing fixes, run focused validation and `pnpm validate:changed --base origin/main --head HEAD`.

Do not post `pr-review` after pushing; pushes trigger reviewer agents. Post `pr-review` only when no push occurred and the reviewer needs to respond, such as after CI passes with no current-head review response or after you reject/clarify a finding.

Continue until CI is green, skipped, or neutral as expected; review threads have no unresolved actionable findings; the latest reviewer response says the PR has no blocking findings or is acceptable for merge; and the merge state has no code-change blocker.

## Report

Report the PR URL, current head SHA, CI result, reviewer result, accepted fixes pushed, rejected findings with reasons, validation run, and any human-only blocker.
