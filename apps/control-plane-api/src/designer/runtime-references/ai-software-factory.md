# AI Software Factory Workflow Reference

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

First propose the plan as a recommended draft:

- issue system and repository system
- issue readiness gate
- workflow states or columns
- implementation role
- review role
- feedback and improvement loop
- human operating guide

Invite corrections in the chat summary before setup choices, but keep the next dashboard decision focused on the first material setup choice rather than plan acceptance.

## Workflow Blueprint Shape

Keep the Workflow blueprint focused on factory behavior, not setup tasks. For an AI software factory, prefer 6-8 core workflow items. Combine related concerns instead of expanding every trigger, route, and output into a separate node.

When using a separate review agent, do not add a separate "PR ready for review" trigger node unless the workflow has multiple independent entry points. Keep the PR output and the review-agent step adjacent so the core factory stays within 6-8 items.

Name the review routing item as a feedback route or otherwise use the word `feedback` in the latest Workflow blueprint. The factory must visibly route review feedback back to implementation.

Good Workflow blueprint items usually include:

- issue intake trigger or manual start with the readiness rule
- readiness check or triage step
- implementation planning, code change, and test step
- pull request output
- review step or review-agent step
- feedback route from review back to implementation
- issue-system status update, including blocked or unclear work
- improvement output for recurring process or instruction gaps

Do not make setup steps into workflow nodes. Repository selection, app setup, profile selection, publishing, and trigger creation belong in chat or setup-focused canvas tabs. Do not attach setup actions to AI software factory Workflow blueprint items; use dashboard requests or setup-focused tabs for those actions after the workflow is aligned.

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

## Profile Instruction Handoff

If Designer cannot directly save profile instructions in the current session, include a concrete instruction draft in the handoff instead of only saying instructions remain. Do this before any final "stop here" handoff.

Use these exact handoff headings:

- `Implementation agent instructions`: a concise draft covering Linear intake, readiness checks, GitHub work, validation, PR proposal behavior, Linear update proposal behavior, escalation, and approval boundaries.
- `Review agent instructions`: a concise draft covering acceptance criteria review, regression/test review, feedback routing, rework criteria, human handoff, and review-quality improvement notes.
- `Linear status mapping`: use a concrete mapping such as `Ready -> Agent In Progress -> Ready for Review -> Needs Rework / Blocked -> Done`, or clearly state the user's equivalent statuses.
- `Human operating guide`: offer to create a README, onboarding issue, example Linear issue, or team workflow guide as the next artifact.

Also state the current configuration shape explicitly. If only one sandbox profile is being edited, say `Configuration shape: one sandbox profile with role-separated implementation and review instructions`. If stronger isolation is needed later, say separate implementation and review profiles can be created as a later improvement.

End with one clear `Next action:` line. Make the next action singular, such as pasting the instruction drafts into the opened profile UI, reviewing the profile draft, or approving publish. Do not leave several remaining tasks with equal priority.

Keep this handoff user-facing. Do not describe internal tool discovery, command lookup, or missing implementation mechanics unless it is the actual blocker the user must act on.

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
- Run actions for testing the factory, such as starting a session today or simulating a trigger only when product tooling supports it

Do not claim the factory is ready if provider setup, labels, statuses, trigger creation, publishing, or profile capability remains incomplete. When Linear setup is incomplete, explicitly say in the final handoff that Linear labels and statuses still need setup or confirmation, even if the chosen pickup rule uses only one `Ready` status.

If the current sandbox profile draft already has required provider tools such as `linear-mcp` or `github-cli`, do not describe those tools as missing or still needing to be bound. Instead, distinguish configured draft capabilities from remaining setup such as instructions, labels, statuses, publishing, and triggers.

When the selected approval boundary requires approval before provider writes, describe the workflow outputs as a PR proposal and Linear update proposal until approval is granted. Do not say the factory will create PRs or post Linear updates directly in that mode.

If Designer cannot edit profile instructions or publish in the current session, do not narrate internal tool checks. Say the user-relevant blocker directly: profile instructions, publishing, or trigger creation must be completed in the opened dashboard/profile UI or in a session with product mutation tools.

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
