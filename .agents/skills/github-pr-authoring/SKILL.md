---
name: github-pr-authoring
description: Draft or update GitHub pull requests for this repository in the required format. Use when creating a PR, revising a PR description, preparing reviewer guidance, documenting checks and tests performed, or using `gh pr create` / `gh pr edit` for repo-compliant GitHub PR authoring.
---

# Github Pr Authoring

1. Base the PR on the actual diff, changed files, and checks. Do not invent tests, commands, or implications.
2. Use this exact body structure:
   - `## What was changed`
   - `## How to review`
   - `## What the implication was`
   - `## Checks and tests performed`
3. For bug fixes, include the original symptom in `## What was changed` only when it adds useful review context.
4. Keep file references in the PR body repo-relative, not absolute local filesystem paths.
5. Use a conventional-commit PR title that summarizes the change.
6. If using `gh`, write the body to a file and use `gh pr create --body-file ...` or `gh pr edit --body-file ...`. Do not pass escaped newline sequences in a one-line argument.
7. Match the PR body to the size and complexity of the change. For small changes, prefer short prose over diagrams, long review checklists, or padded bullet lists.

## Section Expectations

### What was changed

Describe the change concisely. For small PRs, a short paragraph is enough.

For bug fixes, add an `Original symptom this addresses:` block right after the summary when it helps reviewers understand the change.

### How to review

Point reviewers to the relevant file, section, or commit order. Keep this proportional to the diff.

### What the implication was

Describe the practical impact directly. Use Mermaid only when it materially improves understanding.

### Checks and tests performed

List only checks that add reviewer signal. Prefer:

- tests added or updated for this change
- targeted validation outside normal hook coverage
- meaningful manual verification
- broader gates like `pnpm run ci` only when they add coverage beyond the default flow
- for property-based tests, the invariants asserted, generator bounds, and how failures can be replayed from seed/path

Do not restate obvious command behavior. If a routine command simply passed, say that directly.
