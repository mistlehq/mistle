# Storybook

This package hosts the single Storybook for the Mistle monorepo.

## What belongs here

- Shared UI stories from `packages/ui`
- Dashboard stories for prop-driven view components
- Shared Storybook configuration, global CSS imports, and addons

## What should stay out

- App containers that require router, auth, or live session bootstrapping just to render
- Storybook-only aliases for core runtime modules unless there is no other viable path
- Feature logic that should first be split into a presentational view component

## Where to put stories

- Colocate stories with the source component
- Use `*.stories.tsx`
- Keep dashboard stories inside `apps/dashboard/src/**`
- Keep shared UI stories inside `packages/ui/src/**`

## Commands

- `pnpm storybook`
- `pnpm storybook:build`
- `pnpm run ci`
