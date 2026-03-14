---
name: github-pr-authoring
description: Draft or update GitHub pull requests for this repository in the required format. Use when creating a PR, revising a PR description, preparing reviewer guidance, documenting checks and tests performed, or using `gh pr create` / `gh pr edit` for repo-compliant GitHub PR authoring.
---

# Github Pr Authoring

## Overview

Produce a GitHub PR that is ready for reviewers and matches the repository PR contract. Keep the workflow narrow: gather change context, fill the required sections well, and use `gh` in a way that preserves formatting.

## Workflow

1. Read the pull request section in the repository `AGENTS.md`.
2. Inspect the actual diff, changed files, and validation results before drafting. Do not invent tests, commands, or implications.
3. Draft the PR body using the template headings exactly:
   - `## What was changed`
   - `## How to review`
   - `## What the implication was`
   - `## Checks and tests performed`
4. Keep file references in the PR body repo-relative, not absolute local filesystem paths.
5. If opening or editing the PR through GitHub CLI, write the body to a file and use `gh pr create --body-file ...` or `gh pr edit --body-file ...`. Do not pass escaped newline sequences in a one-line argument.

## Section Expectations

### What was changed

Write one short summary paragraph, then list the important touched paths with a brief reason for each. Prefer the smallest set of paths that explains the change.

### How to review

Give reviewers an efficient path through the change:

- entrypoint files or modules
- suggested review order across files or commits
- local commands needed to validate behavior

### What the implication was

Explain the behavioral or architectural effect of the change. Use Mermaid only when it materially improves clarity.

### Checks and tests performed

List the real checks that were run. For each new or updated test case, include:

- what is being tested
- expected outcome
- how the test validates it
- for property-based tests, the invariants, generator bounds, and replay instructions from seed/path

If something was not run, say so directly.

## Guardrails

- Treat `.github/pull_request_template.md` as the GitHub-facing contract, but do not depend on reading it to draft the PR body.
