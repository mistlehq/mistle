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
3. Keep file references in the PR body repo-relative, not absolute local filesystem paths.
4. Use a conventional-commit PR title that summarizes the change.
5. If using `gh`, write the body to a file and use `gh pr create --body-file ...` or `gh pr edit --body-file ...`. Do not pass escaped newline sequences in a one-line argument.
6. Match the PR body to the size and complexity of the change. For small changes, prefer short prose over diagrams, long review checklists, or padded bullet lists.

## Section Expectations

### What was changed

Write a summary no longer than one paragraph describing what was changed. After this summary, provide details including file references (this should be a bullet list with brief explanation about what was touched and why).

For bug fixes, add an `Original symptom this addresses:` block right after the summary.

### How to review

Describe the recommended review path for this PR. Include:

- entrypoint files or modules to read first
- suggested review order across files or commits
- local setup or commands needed to validate behavior

Keep this section proportional to the diff. For trivial changes, a short sentence pointing to the relevant file or section is enough.

### What the implication was

Based on the changes, describe what the exact implications are. Where relevant, use Mermaid diagrams to help illustrate flows or other visual concepts.

### Checks and tests performed

List only checks that add reviewer signal. Prefer:

- For property-based tests, what invariants are asserted, what generator bounds are used, and how failures can be replayed from seed/path
- tests added or updated for this change
- targeted commands that validate behavior not already covered by the normal local hook flow
- meaningful manual testing with concrete scenarios and outcomes
- broader publish gates like `pnpm run ci` when they materially exceed the default hook coverage

Do not restate generic command behavior that is already obvious from the command name. If a routine command simply passed, say that directly.
