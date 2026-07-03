# GitHub PR Review Basic

## Prompt

Help me build an agent that reviews GitHub pull requests.

## Expected Outcome

Designer should show a Workflow blueprint before changing product state, ask the user which GitHub repository to use, and save the selected repository to the target sandbox profile draft.

Designer should keep provider setup and profile publishing separate from the Workflow blueprint.

The Workflow blueprint should describe GitHub pull request review behavior, including the pull request lifecycle, review work, and a runtime approval boundary before posting review comments or otherwise mutating GitHub.

The sandbox profile draft should retain the GitHub CLI provider tool when the repository selection is saved.
