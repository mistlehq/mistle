# Storybook CI Policy

- Do not add Storybook interaction/test execution as a CI gate for Mistle.
- CI should build Storybook, but should not run `test-storybook` or equivalent Storybook test runners.

## Working Preference

- Prefer boundary cleanup over Storybook-specific runtime workarounds.
- Prefer story fixtures over large inline demo payloads.
- Prefer documenting public `packages/ui` exports before adding more runtime-shaped dashboard stories.

## Storybook Docs Guidance

- Put Storybook-visible component descriptions in JSDoc immediately above the story `meta` export in the `*.stories.tsx` file.
- Use that story-meta JSDoc as the Storybook source of truth for review guidance and usage notes.
- Never use `parameters.docs.description.component` for component-level Docs descriptions.
- Always use JSDoc immediately above the story `meta` export for component-level Docs descriptions.
- Write the description for Storybook readers: explain how to use the component and how to evaluate it in the Docs tab.
- Add prop-level docs in the story file with `argTypes.<prop>.description` when the Docs tab needs explicit prop guidance.
- Keep component-source JSDoc for code readers when it helps, and keep Storybook-facing guidance in the story file.
- Reach for Storybook docgen configuration only when there is a broader repo-wide documentation need.
