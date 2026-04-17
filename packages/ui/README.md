# UI Package

Shared UI components and utilities used by the dashboard and other apps.

## Usage

```ts
import { Button, ScreenActionButton } from "@mistle/ui";
```

Import shared styles once in your app entrypoint:

```ts
import "@mistle/ui/styles.css";
```

Peer dependencies: `react`, `react-dom` (React 19).

## ScreenActionButton

`ScreenActionButton` is the shared CTA primitive for simple, uncluttered screens where one of a small number of actions should be visually dominant.

Use it for:

- login and auth screens
- invitation and access-state screens
- simple empty, success, or error pages with one or two clear next steps

Do not use it for:

- dense settings forms with many competing actions
- toolbars, menus, tables, or inline row actions
- places where standard `Button` sizing already fits the surrounding layout

Example:

```tsx
<ScreenActionButton type="submit">Continue with email</ScreenActionButton>
```

Current uses in this repo include the dashboard auth flow, invitation acceptance flow, and no-organization-access screens.

## Scripts

```bash
pnpm --filter @mistle/ui typecheck
pnpm --filter @mistle/ui test
```
