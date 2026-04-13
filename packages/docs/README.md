# @mistle/docs

Public docs for Mistle, built with Mintlify.

## Local Development

With Nix, use the docs-specific shell so Mint runs on Node 22 instead of the repository's default Node 25 shell:

```bash
nix develop .#docs -c pnpm --filter @mistle/docs dev
```

If you are already inside the docs shell, you can run:

```bash
pnpm --filter @mistle/docs dev
```

The Mintlify preview runs on port `3333`.

## Validation

```bash
pnpm --filter @mistle/docs lint
pnpm --filter @mistle/docs validate
```

`lint` runs strict broken-link and accessibility checks and fails on Mint warnings.
