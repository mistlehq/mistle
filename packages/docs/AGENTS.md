## Purpose

- `packages/docs/` is the public documentation site for end users and operators.
- Internal plans, contributor policies, implementation notes, and engineering-only process docs do not belong here.

## Product Screenshots

- Use `apps/dashboard/src/features/pages/product-docs-screens.stories.tsx` as the centralized source for dashboard-owned public docs screenshots.
- Add or update the Storybook story and the checked-in image under `packages/docs/images/product-screens/` in the same change.
- Reference checked-in images from MDX with `/images/product-screens/<name>.png`.
- Review each captured screenshot before adding it to docs. It should show the relevant product section clearly.
- Crop screenshots when they include large whitespace, unrelated chrome, or unnecessary surrounding sections that distract from the documented feature.
