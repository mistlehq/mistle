---
name: github-pr-authoring
description: Draft or update GitHub pull requests for this repository in the required format. Use when creating a PR, revising a PR description, preparing reviewer guidance, documenting checks and tests performed, or using `gh pr create` / `gh pr edit` for repo-compliant GitHub PR authoring.
---

# Github Pr Authoring

## Overview

Produce a GitHub PR that is ready for reviewers and matches the repository PR contract. Keep the workflow narrow: gather change context, fill the required sections well, and use `gh` in a way that preserves formatting.

## Workflow

1. Base the PR on the actual diff, changed files, and checks. Do not invent tests, commands, or implications.
2. Use this exact body structure:
   - `## What was changed`
   - `## How to review`
   - `## What the implication was`
   - `## Checks and tests performed`
3. Keep file references in the PR body repo-relative, not absolute local filesystem paths.
4. Use a conventional-commit PR title that summarizes the change.
5. If using `gh`, write the body to a file and use `gh pr create --body-file ...` or `gh pr edit --body-file ...`. Do not pass escaped newline sequences in a one-line argument.

## Section Expectations

### What was changed

Write a summary no longer than one paragraph describing what was changed. After this summary, provide details including file references (this should be a bullet list with brief explanation about what was touched and why).

### How to review

Describe the recommended review path for this PR. Include:

- entrypoint files or modules to read first
- suggested review order across files or commits
- local setup or commands needed to validate behavior

### What the implication was

Based on the changes, describe what the exact implications are. Where relevant, use Mermaid diagrams to help illustrate flows or other visual concepts.

### Checks and tests performed

List of checks and tests performed to validate the changes. When listing tests, each test must cover:

- What is being tested
- What is the expected outcome
- How the test is implemented
- For property-based tests, what invariants are asserted, what generator bounds are used, and how failures can be replayed from seed/path
