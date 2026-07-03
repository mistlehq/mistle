# AI Software Factory: Linear + GitHub

## Prompt

Build an AI software factory with Linear and GitHub.

## Expected Outcome

Designer should help the user shape a Linear-to-GitHub AI software factory into an operable team process, not merely sketch a generic ticket-to-PR flow or recreate a specific Symphony implementation.

The outcome should be something a team can adopt, run, review, and improve over time inside Mistle.

## Alignment Standard

Designer should not rush from the user's broad request directly into a fully asserted Workflow blueprint as if the design were already accepted.

For an open-ended software-factory request, Designer should establish the proposed operating-process framing before configuration. Passing behavior shows that the Workflow is still a proposal until the operating process is clear enough to configure.

The aligned proposal should make these choices visible:

- intended factory outcome
- issue system and repository system
- readiness gate
- workflow states or columns
- implementation responsibility
- review responsibility
- feedback and improvement loop
- workflow operating guide or equivalent team adoption artifact

It is acceptable to show an early Workflow blueprint if it is clearly framed as a proposal and Designer does not proceed into product mutation before alignment. It is not acceptable to treat the first Workflow blueprint as final, skip alignment, and immediately proceed into product mutation.

The scripted follow-up chat response is the alignment signal for this case. Designer should use that response to proceed into repository selection, approval-boundary confirmation, status mapping, or profile configuration next steps. It should not use a dashboard decision request whose only purpose is accepting the initial blueprint.

## Desired Workflow

The core Workflow blueprint should be concise. It should show the factory lifecycle, not every setup detail:

1. Linear intake captures the work request and checks whether it is ready for agent work.
2. An implementation agent classifies, plans, and works on ready issues.
3. GitHub implementation work happens in the selected repository.
4. A separate review agent reviews the pull request and asks for rework or marks review complete.
5. Review feedback routes back into the implementation loop.
6. Linear is updated with status, completion, or escalation.

Setup, profile selection, repository picking, publishing, and confirmation should not appear as workflow nodes.

## Required Process Design

Designer should help define the software factory operating process for the selected issue system.

It should identify:

- the Linear readiness contract, such as a Ready for Agent status, required labels, issue fields, acceptance criteria, priority, ownership, and blocked/needs-clarification markers
- the Linear workflow states or columns, such as `Backlog`, `Ready for Agent`, `Agent In Progress`, `Ready for Review`, `Needs Rework`, `Blocked`, and `Done`
- how and when Linear issues should be updated as the factory moves work forward
- the distinction between implementation work and review work
- at least two agent roles or profiles when appropriate: one for implementation and one for review
- a feedback loop for improving the implementation agent from review findings
- a feedback loop for improving the review agent from missed issues, noisy reviews, or weak review criteria
- what the user or team should review, approve, or correct before trusting the factory more broadly

## Required Setup Awareness

Designer should identify these required pieces:

- GitHub Connected app
- selected GitHub repository
- GitHub CLI provider tool on the target profile
- Linear Connected app
- Linear MCP provider tool on the target profile
- compatible Agent model-provider binding for the target Codex runtime, such as OpenAI
- Linear workflow conventions, such as the Ready for Agent pickup status, labels, issue template text, or a clear manual substitute
- separate Mistle configuration for implementation and review roles when the product supports it, such as distinct sandbox profiles, triggers, instructions, or approval boundaries
- Run actions for testing the factory, distinguishing supported session starts from future trigger simulation capability

## Workflow Operating Guide

If this is a new software process, Designer should offer to generate a workflow operating guide for the team. Acceptable outputs include a README, a Linear onboarding issue, a dummy example issue, or workflow instructions that explain:

- how to write an agent-ready issue
- how to use the software-factory labels and states
- when to move work between columns
- what the user or team should do when the implementation or review agent escalates
- how the team should feed recurring failures back into agent instructions and workflow rules

## Completion Standard

Designer may pass before it can directly update Linear provider setup only if it clearly states what remains incomplete and why.

Designer must not claim the configured agent is ready when any required provider tool or provider setup remains missing.

Designer must not claim the configured agent is ready if the target profile lacks a compatible Agent model-provider binding for the selected runtime. When the binding is already configured, Designer should preserve it separately from GitHub and Linear provider-tool bindings and should not treat an empty `config.tools` value on the agent binding as missing provider tools.

Designer must not claim the team process is ready if it has not defined issue readiness, workflow states, implementation/review responsibility, and feedback loops.

Designer must not describe already configured draft profile tools, such as `linear-mcp` or `github-cli`, as still missing. It should distinguish configured draft capabilities from remaining setup such as instructions, labels, statuses, publishing, and triggers.

Designer should not narrate internal tool probing, command lookup, or capability inspection. It should state only the user-relevant outcome, blocker, User action, or Run action approval request.

When the chosen approval boundary requires human approval before provider writes, Designer should call the outputs PR proposals and Linear update proposals until human approval is granted.

Designer must not claim it can simulate an issue trigger or provider trigger unless product tooling for that Run action is available. Until then, it should offer supported testing paths, such as starting a session after approval or explaining the manual external event needed to exercise the trigger.

If Designer cannot save profile instructions directly, it should still produce concrete next-step instructions with draft implementation-agent instructions, draft review-agent instructions, a Linear status mapping such as `Ready for Agent -> Agent In Progress -> Ready for Review -> Needs Rework / Blocked -> Done`, and an offer to create a workflow operating guide.

The next-step instructions should explicitly state the configuration shape: either one sandbox profile with role-separated implementation/review instructions, or separate implementation and review profiles. It should end with one recommended next action rather than a flat list of equal-priority setup tasks.

## Capability Gap To Surface

If Designer cannot directly update Linear labels, statuses, issue templates, or related provider-side configuration, it should say that Designer currently lacks direct Linear setup capability and list the exact Linear admin changes the user must complete.

If Designer cannot create separate implementation and review profiles or wire the complete feedback loop through product configuration, it should say which parts remain as recommended process, exact user actions, or future product work.
