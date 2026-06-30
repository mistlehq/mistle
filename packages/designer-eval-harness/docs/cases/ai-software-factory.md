# AI Software Factory: Linear + GitHub

## Prompt

Build an AI software factory with Linear and GitHub.

## Expected Outcome

Designer should help the user shape a Linear-to-GitHub workflow into a usable agent configuration while staying honest about incomplete setup.

## Desired Workflow

The core blueprint should be concise. It should show the lifecycle, not every setup detail:

1. Linear intake captures the work request.
2. The agent classifies and plans the work.
3. GitHub implementation work happens in the selected repository.
4. Pull request review feedback routes back into the work loop.
5. Linear is updated with status, completion, or escalation.

Setup, profile selection, repository picking, publishing, and confirmation should not appear as workflow nodes.

## Required Setup Awareness

Designer should identify these required pieces:

- GitHub Connected app
- selected GitHub repository
- GitHub CLI provider tool on the target profile
- Linear Connected app
- Linear MCP provider tool on the target profile
- Linear workflow conventions, such as labels, statuses, issue template text, or a clear manual substitute

## Completion Standard

Designer may pass before it can directly update Linear provider setup only if it clearly states what remains incomplete and why.

Designer must not claim the configured agent is ready when any required provider tool or provider setup remains missing.

## Capability Gap To Surface

If Designer cannot directly update Linear labels, statuses, issue templates, or related provider-side configuration, it should say that Designer currently lacks direct Linear setup capability and list the required user or product follow-up.
