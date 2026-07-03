# AI Software Factory Workflow Reference

Use this reference when a user asks for an AI software factory, issue-to-PR factory, engineering agent workflow, autonomous coding workflow, or similar process that turns issue-system work into code changes and review.

There is no single correct AI software factory. Design the operating process that fits the user's issue system, repository system, review standards, and trust level.

## Core Concepts

An AI software factory helps a team move software work from an issue system into implementation, review, and completion with agent assistance.

A useful design defines:

- which work is ready for agents
- how work moves through the issue system
- which Agent or Task implements changes
- which Agent, Task, or reviewer checks changes
- how pull request feedback routes back into implementation
- how recurring misses, bad reviews, failed runs, or blockers improve the factory

## Workflow Shape

Keep the factory workflow focused on operating behavior, not setup tasks. For an AI software factory, prefer 6-8 core responsibilities. Combine related concerns instead of expanding every trigger, route, and output into a separate responsibility.

When using a separate review agent, do not treat "PR ready for review" as a separate workflow entry point unless the workflow truly has multiple independent entry points. Keep the PR output and review responsibility adjacent so the core factory stays within 6-8 responsibilities.

Review feedback must loop back into implementation before the workflow reaches completion. The factory should make rework, accepted work, and blocked or unclear outcomes easy to distinguish.

Good factory workflows usually include:

- issue intake trigger or manual start with the readiness rule
- readiness check or triage step
- implementation planning, code change, and test step
- pull request output
- review step or review-agent step
- feedback or rework path from review back to implementation
- issue-system status update, including blocked or unclear work
- improvement output for recurring process or instruction gaps

Do not make setup steps part of the factory workflow. Repository selection, App setup, profile selection, publishing, and trigger creation belong in chat or setup-focused canvas tabs after alignment.

## Readiness And State Model

Define how the issue system marks work as ready.

Common readiness signals:

- a status such as `Ready for Agent`, `Ready for AI`, or `Ready`
- a label such as `agent-ready`, `ai-factory-ready`, or `ready-for-agent`
- required fields for acceptance criteria, affected area, priority, and owner
- explicit blockers or needs-clarification markers
- a manual-start mode for early trials

Define how work moves through the issue system.

Common states:

- `Backlog`
- `Ready for Agent`
- `Agent In Progress`
- `Ready for Review`
- `Needs Rework`
- `Blocked`
- `Done`

Status names vary by issue system. Use the user's actual labels, fields, and workflow language when known.

## Implementation And Review Responsibilities

Separate implementation and review when the factory needs quality control.

Implementation responsibility:

- reads the issue and acceptance criteria
- plans implementation
- edits code
- runs relevant checks
- opens or updates a pull request
- reports status back to the issue system

Review responsibility:

- reviews the pull request and test evidence
- checks acceptance criteria
- identifies regressions, missing tests, or unclear behavior
- asks for rework or marks review complete
- records recurring review failures for future improvement

For simple early trials, a single implementation agent plus human review can be acceptable. For stronger factories, recommend separate sandbox profiles, triggers, instructions, approval boundaries, or sessions for implementation and review responsibilities when product capabilities support them.

## Feedback Loop

A factory should improve from its own results.

Useful feedback signals include:

- review comments that repeatedly ask for the same fixes
- failed tests or flaky validation
- implementation plans that missed important files
- review agents that produce noisy or weak feedback
- blocked issues caused by missing acceptance criteria
- user corrections to status transitions or escalation

Useful improvement outputs include:

- updated agent instructions
- refined issue templates
- changed readiness rules
- improved review criteria
- added validation checks
- tightened approval boundaries

## Configuration Awareness

For Linear and GitHub, identify these pieces:

- Linear Connected app
- Linear MCP provider tool when the agent must read or update Linear
- Linear labels, statuses, issue templates, or a manual substitute
- GitHub Connected app
- selected GitHub repository
- GitHub CLI provider tool when the agent must branch, commit, or open pull requests
- implementation profile or instructions
- review profile or instructions when a separate review responsibility is recommended
- trigger and publishing configuration that still needs to be completed
- Run actions for testing the factory, such as starting a session today or simulating a trigger only when product tooling supports it

Do not claim the factory is ready if provider setup, labels, statuses, trigger creation, publishing, or profile capability remains incomplete.

If the current sandbox profile draft already has required provider tools such as `linear-mcp` or `github-cli`, do not describe those tools as missing or still needing to be bound. Distinguish configured draft capabilities from remaining configuration such as instructions, labels, statuses, publishing, and triggers.

When the selected approval boundary requires human approval before provider writes, describe the workflow outputs as a PR proposal and Linear update proposal until human approval is granted. Do not say the factory will create PRs or post Linear updates directly in that mode.

If Designer cannot edit profile instructions or publish in the current session, name the blocker directly: profile instructions, publishing, or trigger creation must be completed in the opened dashboard/profile UI or in a session with product mutation tools.

## Provider-Specific Notes

Linear:

- Model readiness with status, labels, team/project scope, issue fields, or manual start.
- Discuss whether the agent should update comments, labels, assignees, or statuses.
- If Designer cannot directly configure Linear labels, statuses, templates, or workflow states, list the exact Linear admin changes the user must complete.

Jira:

- Model readiness with issue type, status, custom fields, labels, board columns, and JQL pickup lanes.
- Review whether workflow transitions and resolution rules need admin setup.

GitHub Issues:

- Model readiness with labels, issue forms, projects, milestones, assignees, and comments.

GitHub Pull Requests:

- Decide whether the implementation agent opens draft PRs, ready-for-review PRs, or asks each time.
- Keep human review explicit until the team has confidence in the factory.

## Completion Criteria

A complete factory design identifies:

- the issue system and repository system
- the readiness rule
- the issue-state or status model
- implementation and review responsibilities
- review feedback routing
- issue-system update behavior
- provider setup and selected resources
- required provider tools
- publishing and trigger status
- approval boundaries for provider writes
- how recurring failures update the process
- any exact user actions that remain outside Designer's available tools

## Example Outputs

Useful output artifacts can include:

- implementation-agent instruction draft
- review-agent instruction draft
- issue status mapping, such as `Ready -> Agent In Progress -> Ready for Review -> Needs Rework / Blocked -> Done`
- workflow operating guide for the team
- example issue or onboarding issue
- configuration shape summary, such as one sandbox profile with role-separated instructions or separate implementation and review profiles
