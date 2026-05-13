# Release Process

`mistle` ships as one versioned system, even though the repository is a monorepo.

## Source of truth

- `VERSION` is the canonical release version.
- Stable tags use `vX.Y.Z`.
- Alpha prerelease tags use `vX.Y.Z-alpha.N`.
- The GitHub releases page is the canonical changelog.

## Preparing a release

1. Choose the release intent.
2. Run:

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

3. Review the changes to:
   - the current branch, which will now be `release/v$(cat VERSION)`
   - `VERSION`
   - `packages/sandboxd/Cargo.toml`
   - committed OpenAPI specs
4. Run:

```sh
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm run ci
```

5. Commit the release prep as:

```sh
git commit -am "chore(release): v$(cat VERSION)"
```

6. Open a PR from `release/v$(cat VERSION)` to `main`.

## Cutting the release

1. Merge the release PR to `main`.
2. Create the tag:

```sh
pnpm release:create-tag
```

For stable releases, you can preview the release notes locally before creating the GitHub release body:

```sh
pnpm release:write-notes
```

3. Push the tag:

```sh
git push origin "v$(cat VERSION)"
```

4. The tag-based release workflow publishes the release automatically.

The release workflow publishes:

- service images as `ghcr.io/mistlehq/<service>:v$(cat VERSION)`
- the sandbox base image as `ghcr.io/mistlehq/sandbox-base:v$(cat VERSION)`
- single-container images as `ghcr.io/mistlehq/mistle:docker-v$(cat VERSION)` and `ghcr.io/mistlehq/mistle:remote-v$(cat VERSION)`
- a GitHub release with `dist/release-manifest.json` attached

The `docker` single-container image includes the local Docker sandbox runtime. The `remote` single-container image is for deployments that use a remote sandbox provider and does not bundle the local Docker runtime.

## Notes

- `latest` container tags are reserved for stable releases only.
- Stable releases also publish `latest`, `docker-latest`, and `remote-latest` aliases.
- Image jobs first publish commit-scoped tags, then a promotion job applies release and latest aliases by digest after all images build successfully. If a release workflow fails before promotion, rerun it; the remaining SHA tags are safe to leave in GHCR.
- The first release note is intentionally short instead of trying to summarize the full pre-release history.
- Stable releases get a generated GitHub release body. Alpha releases are published without a release body.
