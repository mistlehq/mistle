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

## Notes

- `latest` container tags are reserved for stable releases only.
- The first release note is intentionally short instead of trying to summarize the full pre-release history.
- Stable releases get a generated GitHub release body. Alpha releases are published without a release body.
