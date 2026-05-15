# Maintenance Script Snapshot Refresh

Scheduled snapshot refreshes choose their preparation path from the current Sandbox profile version state at execution time. When the target version has a saved Maintenance script, the refresh starts from the current usable Snapshot and runs that script; otherwise the refresh starts from the configured Base image and runs the Setup script.

The Maintenance script is scoped to a Sandbox profile version, but unlike ordinary published-version configuration it may be edited without creating a draft, publishing a new version, or rebuilding from the Setup script. Snapshot jobs do not capture the script text or a separate refresh mode in the first implementation; the refresh execution reads the latest saved Maintenance script and logs which path it selected.

When a new Sandbox profile version is published, version-scoped refresh settings are copied forward from the previous version. That includes the Maintenance script and refresh schedule configuration. Snapshot image state, in-progress jobs, and schedule cursor state are not copied; the new published version still creates its own initial setup snapshot, and copied schedules recompute their next occurrence from publish time.

## Consequences

- Published sandbox profile versions have one intentionally mutable field: the Maintenance script.
- A scheduled refresh may run a different script than the one present when the schedule became due if the Maintenance script is edited before execution.
- Maintenance script test runs start from the existing usable Snapshot and do not replace it.
- The first implementation keeps the database model small and can add job-level script capture later if execution-time races become a problem.
- Refresh settings follow newly published versions without carrying over old snapshot images or active jobs.
- Copied schedules keep their definition but do not replay stale due work from the previous version.
