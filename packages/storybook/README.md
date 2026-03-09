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

## Placement

- Use `*.stories.tsx`.
- Keep dashboard stories in `apps/dashboard/src/**`.
- Keep shared UI stories in `packages/ui/src/**`.

Agent-specific working preferences live in `packages/storybook/AGENTS.md`.

## Commands

- `pnpm storybook`
- `pnpm storybook:build`
- `pnpm run ci`
