# GitHub PR Review Basic

## Prompt

Help me build an agent that reviews GitHub pull requests.

## Expected Outcome

Designer should show a Workflow blueprint before changing product state, ask the user which GitHub repository to use, and save the selected repository to the target sandbox profile draft.

For this broad initial request, the first Workflow blueprint is a recommendation rather than alignment by itself. Designer should wait for the follow-up chat response before saving repository selections or making other configuration changes.

Designer should keep provider setup and profile publishing separate from the Workflow blueprint.

The Workflow blueprint should describe GitHub pull request review behavior, including the pull request lifecycle, review work, and an approval boundary before posting review comments or otherwise mutating GitHub.

The sandbox profile draft should retain the GitHub CLI provider tool when the repository selection is saved, and it should retain a compatible agent model-provider binding for the selected Codex runtime.
