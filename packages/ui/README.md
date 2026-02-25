# UI Package

Shared UI components and utilities used by the dashboard and other apps.

## Usage

```ts
import { Button } from "@mistle/ui";
```

Import shared styles once in your app entrypoint:

```ts
import "@mistle/ui/styles.css";
```

Peer dependencies: `react`, `react-dom` (React 19).

## Scripts

```bash
pnpm --filter @mistle/ui typecheck
pnpm --filter @mistle/ui test
```
