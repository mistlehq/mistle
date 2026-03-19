# Dashboard Agent Guidance

- All files and folders in `apps/dashboard` must use kebab-case names.
- Exceptions: `apps/dashboard/README.md` and `apps/dashboard/AGENTS.md` are allowed as-is.
- This is enforced by `apps/dashboard/lint/check-file-names.ts`.
- Shared dashboard test fixtures and test-only setup helpers should live under `apps/dashboard/src/test-support/`, not inside production feature folders.
- Prefer feature-local test helpers only when they are truly private to one feature's tests; move reusable auth/session/query fixtures into `src/test-support/`.
