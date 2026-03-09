# Storybook CI Policy

- Do not add Storybook interaction/test execution as a CI gate for Mistle.
- CI should build Storybook, but should not run `test-storybook` or equivalent Storybook test runners.

## Working Preference

- Prefer boundary cleanup over Storybook-specific runtime workarounds.
- Prefer story fixtures over large inline demo payloads.
- Prefer documenting public `packages/ui` exports before adding more runtime-shaped dashboard stories.
