# Storybook

This package hosts the single Storybook for the Mistle monorepo.

## Scope

- Shared UI stories from `packages/ui`
- Selected dashboard stories
- Shared Storybook configuration, global CSS imports, and addons

## Component Boundary

- Put components in `packages/ui` only if they are app-agnostic, reusable, and safe to expose as shared UI API.
- Keep dashboard-specific or product-aware components in `apps/dashboard`.

## Dashboard Story Rules

- Story prop-driven `*-view.tsx` components.
- Story self-contained local-state components only if they do not depend on app runtime services.
- Do not story components that require auth, session bootstrapping, React Query wiring, live service clients, runtime env setup, or more than trivial `MemoryRouter` support.
- If a component is worth storying but depends on runtime state, split out a view component first.

## Dashboard Story Naming

- Use top-level dashboard product areas in alphabetical order.
- Add a feature subgroup only when it improves finding related stories.
- Use leaf names that describe the surface type instead of repeating the product area name.
- Prefer `PageView` for prop-driven presentational page stories.
- Reserve `Page` for runtime or container-shaped page stories.
- Prefer consistent surface suffixes such as `Dialog`, `Panel`, `Section`, `Field`, `ListView`, `DetailView`, and `Tile`.

## Dashboard Story Decorators

- Use `withDashboardCenteredStory` for isolated component previews such as dialogs, cards, tiles, fields, and other intentionally staged surfaces.
- Use `withDashboardPageStory` for document-flow pages. This decorator should not add fake width, padding, or centering that changes perceived page layout.
- Use `withDashboardWorkspaceStory` for viewport-managed app surfaces such as session workbenches and split-pane shells.
- Let the real component or shell own layout spacing. Decorators should provide Storybook-safe framing, not substitute for production layout.

## Placement

- Use `*.stories.tsx`.
- Keep dashboard stories in `apps/dashboard/src/**`.
- Keep shared UI stories in `packages/ui/src/**`.
- Keep Storybook-only helpers, decorators, and `*.story-fixtures.*` files out of the dashboard app tsconfig surface.
- Validate dashboard stories through `@mistle/storybook`, not through `@mistle/dashboard` runtime typecheck.

## Fixtures

- Prefer neutral feature fixtures when both tests and stories need the same sample data.
- Reserve `*.story-fixtures.ts` or `*.story-fixtures.tsx` for Storybook-only composition.
- Do not import story fixtures from dashboard tests.

Agent-specific working preferences live in `packages/storybook/AGENTS.md`.

## Commands

- `pnpm storybook`
- `pnpm storybook:build`
- `pnpm run ci`
