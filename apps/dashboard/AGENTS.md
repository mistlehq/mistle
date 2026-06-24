# Dashboard Agent Guidance

- All files and folders in `apps/dashboard` must use kebab-case names.
- Exceptions: `apps/dashboard/README.md` and `apps/dashboard/AGENTS.md` are allowed as-is.
- This is enforced by `apps/dashboard/lint/check-file-names.ts`.
- Shared dashboard test fixtures and test-only setup helpers should live under `apps/dashboard/src/test-support/`, not inside production feature folders.
- Prefer feature-local test helpers only when they are truly private to one feature's tests; move reusable auth/session/query fixtures into `src/test-support/`.

## Loading UI

- The dashboard uses a shared top loading bar. Do not create loading UI for pages.

## Mistle Designer

- For open-ended build requests, Mistle Designer should show a workflow blueprint before asking the user to choose or create product resources.
- After the workflow is visible, Designer may inspect sandbox profiles and recommend suitable existing profiles instead of presenting an unranked picker.
- Profile recommendations should explain the concrete fit: required integration access, trigger compatibility, published/readiness state, and whether the profile purpose appears aligned with the requested workflow.
- Always keep "create a new sandbox profile" as a first-class option alongside recommended existing profiles.
- If many profiles exist, show the recommended shortlist first. Offer "Show all profiles" as a secondary path for users who know a specific profile or want to inspect the complete list.
- Do not represent sandbox profile selection, integration setup, provider-resource selection, or confirmation as blueprint graph nodes. Keep those decisions in chat or ordinary dashboard route tabs after workflow alignment.

## React Effects

- Do not add `useEffect` for app-internal state flow.
- `useEffect` is allowed only when synchronizing React with an external system that requires setup and cleanup.
- Prefer these alternatives:
  derive values during render, use TanStack Query for server data, run user-triggered work in event handlers or mutation callbacks, use `key`-based remounting for fresh state, and move state boundaries downward so children mount only when preconditions are satisfied.
- Do not use `useEffect` for:
  copying props, state, or query data into local state; fetching data; relaying actions through state flags; resetting state because an id, route param, or selected record changed; or keeping two pieces of React state synchronized.
- `useEffect` is acceptable for:
  DOM subscriptions and browser APIs, timers and intervals with cleanup, imperative third-party widgets, sockets and streams, terminal or session lifecycle wiring, and registration with an external owner when cleanup is required.
- Every new `useEffect` must include a short code comment or PR note stating which external system it synchronizes with and why render logic, event handlers, React Query, or remounting were not sufficient.

## React Compiler

- React Compiler is enabled for `apps/dashboard` builds.
- Follow the Rules of React; compiler optimizations are skipped when rules are violated.
- Keep renders pure: do not cause side effects or mutate shared values during render.
- Do not rely on `useMemo` or `useCallback` for correctness. They may still help readability or interoperability, but behavior must remain correct without them.
