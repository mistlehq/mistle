# AI Software Factory Workflow Pattern

Use this reference when a user asks for an AI software factory, issue-to-PR factory, engineering agent workflow, autonomous coding workflow, or similar process that turns issue-system work into code changes and review.

There is no single correct AI software factory. Design the operating process that fits the user's issue system, repository system, review standards, and trust level.

## Core Outcome

An AI software factory helps a team move software work from an issue system into implementation, review, and completion with agent assistance.

A useful design defines:

- which work is ready for agents
- how work moves through the issue system
- which agent role implements changes
- which agent or human role reviews changes
- how pull request feedback routes back into implementation
- how the team improves the factory from misses, bad reviews, failed runs, or repeated blockers

## Conversation Flow

For a broad factory request, do not jump straight into setup.

First propose the operating model as a draft:

- issue system and repository system
- issue readiness gate
- workflow states or columns
- implementation role
- review role
- feedback and improvement loop
- human operating guide

Ask the user to confirm or correct the direction before treating the blueprint as accepted. An early blueprint is acceptable only when it is framed as a draft for review before setup choices.

## Blueprint Shape

Keep the blueprint focused on factory behavior, not setup tasks. For an AI software factory, prefer 6-8 core workflow items. Combine related concerns instead of expanding every trigger, route, and output into a separate node.

Good blueprint items usually include:

- issue intake trigger or manual start with the readiness rule
- readiness check or triage step
- implementation planning, code change, and test step
- pull request output
- review step or review-agent step
- feedback route from review back to implementation
- issue-system status update, including blocked or unclear work
- improvement output for recurring process or instruction gaps

Do not make setup steps into workflow nodes. Repository selection, app setup, profile selection, publishing, and trigger creation belong in chat or setup-focused canvas tabs.

## Issue Readiness Contract

Define how the issue system marks work as ready.

Common readiness signals:

- a status such as `Ready for Agent`, `Ready for AI`, or `Ready`
- a label such as `agent-ready`, `ai-factory-ready`, or `ready-for-agent`
- required fields for acceptance criteria, affected area, priority, and owner
- explicit blockers or needs-clarification markers
- a manual-start mode for early trials

Ask for one concrete readiness rule before creating or recommending triggers.

## Workflow States

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

## Agent Roles

Separate implementation and review when the factory needs quality control.

Implementation role:

- reads the issue and acceptance criteria
- plans implementation
- edits code
- runs relevant checks
- opens or updates a pull request
- reports status back to the issue system

Review role:

- reviews the pull request and test evidence
- checks acceptance criteria
- identifies regressions, missing tests, or unclear behavior
- asks for rework or approves human handoff
- records recurring review failures for future improvement

For simple early trials, a single implementation agent plus human review can be acceptable. For stronger factories, recommend separate sandbox profiles, triggers, instructions, approval policies, or sessions for implementation and review roles when product capabilities support them.

## Feedback And Improvement Loop

A factory should improve from its own results.

Define how these signals feed back into the process:

- review comments that repeatedly ask for the same fixes
- failed tests or flaky validation
- implementation plans that missed important files
- review agents that produce noisy or weak feedback
- blocked issues caused by missing acceptance criteria
- human corrections to status transitions or escalation

Good follow-up actions include updating agent instructions, refining issue templates, changing readiness rules, improving review criteria, adding validation checks, or tightening approval boundaries.

## Human Operating Guide

Offer to create or draft a human-facing operating guide when this is a new process.

Useful guide formats:

- README
- issue-system onboarding issue
- dummy example issue
- team workflow instructions

The guide should explain:

- how to write an agent-ready issue
- which labels, fields, or statuses to use
- when humans should move work between states
- when implementation starts
- how review and rework happen
- when to escalate
- how recurring failures update the factory process

## Setup Awareness

For Linear and GitHub, Designer should identify these pieces:

- Linear Connected app
- Linear MCP provider tool when the agent must read or update Linear
- Linear labels, statuses, issue templates, or a manual substitute
- GitHub Connected app
- selected GitHub repository
- GitHub CLI provider tool when the agent must branch, commit, or open pull requests
- implementation profile or instructions
- review profile or instructions when a separate review role is recommended
- trigger and publishing steps that still require explicit approval

Do not claim the factory is ready if provider setup, labels, statuses, trigger creation, publishing, or profile capability remains incomplete. When Linear setup is incomplete, explicitly say in the final handoff that Linear labels and statuses still need setup or confirmation, even if the chosen pickup rule uses only one `Ready` status.

## Provider-Specific Notes

Linear:

- Model readiness with status, labels, team/project scope, issue fields, or manual start.
- Discuss whether the agent should update comments, labels, assignees, or statuses.
- If Designer cannot directly configure Linear labels, statuses, templates, or workflow states, disclose that gap and list the user-owned setup.

Jira:

- Model readiness with issue type, status, custom fields, labels, board columns, and JQL pickup lanes.
- Review whether workflow transitions and resolution rules need admin setup.

GitHub Issues:

- Model readiness with labels, issue forms, projects, milestones, assignees, and comments.

GitHub Pull Requests:

- Decide whether the implementation agent opens draft PRs, ready-for-review PRs, or asks each time.
- Keep human review explicit until the team has confidence in the factory.
