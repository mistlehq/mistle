# Release Process

`mistle` ships as one versioned system, even though the repository is a monorepo.

## Source of truth

- `VERSION` is the canonical release version.
- Stable tags use `vX.Y.Z`.
- Alpha prerelease tags use `vX.Y.Z-alpha.N`.
- The GitHub releases page is the canonical changelog.

## Preparing a release

1. Choose the release intent.
2. Start the release PR:

```sh
pnpm release:start stable
```

or:

```sh
pnpm release:start alpha
```

or, when you need an explicit override:

```sh
pnpm release:start --release-as 0.1.0
```

`release:start` requires a clean tracked working tree on `main`. It prepares the release,
commits the generated release changes to `release/v$(cat VERSION)`, pushes that branch,
and opens a PR to `main` with release notes generated from `cliff.toml`.

3. Review the release PR and wait for CI to pass.

For additional local validation before merging, run:

```sh
pnpm check:fast
```

## Cutting the release

1. Merge the release PR to `main`.
2. Update local `main` to the merged release commit.

```sh
git switch main
git pull --ff-only origin main
```

3. Create the tag:

```sh
pnpm release:create-tag
```

For stable releases, you can preview the release notes locally before creating the GitHub release body:

```sh
pnpm release:write-notes
```

4. Push the tag:

```sh
git push origin "v$(cat VERSION)"
```

5. The tag-based release workflow publishes the release automatically.

The release workflow publishes:

- service images as `ghcr.io/mistlehq/<service>:v$(cat VERSION)`
- the sandbox base image as `ghcr.io/mistlehq/sandbox-base:v$(cat VERSION)`
- the single-container image as `ghcr.io/mistlehq/mistle:v$(cat VERSION)`
- a GitHub release with `dist/release-manifest.json` attached

## Notes

- `latest` container tags are reserved for stable releases only.
- Stable releases also publish the `latest` alias.
- Image jobs first publish commit-scoped tags, then a promotion job applies release and latest aliases by digest after all images build successfully. If a release workflow fails before promotion, rerun it; the remaining SHA tags are safe to leave in GHCR.
- The first release note is intentionally short instead of trying to summarize the full pre-release history.
- Stable releases get a generated GitHub release body. Alpha releases are published without a release body.
- `pnpm release:prepare`, `pnpm release:notes`, and `pnpm release:write-notes` are lower-level maintenance commands. The normal release entrypoint is `pnpm release:start`.
