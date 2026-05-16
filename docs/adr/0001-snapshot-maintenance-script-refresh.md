# Snapshot Maintenance Script Refresh

Scheduled snapshot refreshes choose their preparation path from the current Sandbox profile version state at execution time. When the target version has a saved Snapshot maintenance script, the refresh starts from the current usable Snapshot and runs that script; otherwise the refresh starts from the configured Base image and runs the Setup script.

The Snapshot maintenance script is scoped to a Sandbox profile version, but unlike ordinary published-version configuration it may be edited without creating a draft, publishing a new version, or rebuilding from the Setup script. Snapshot jobs do not capture the script text or a separate refresh mode in the first implementation; the refresh execution reads the latest saved Snapshot maintenance script and logs which path it selected.

The dashboard should present and save the Snapshot maintenance script as part of Automatic snapshot refresh rather than as a separate configuration mode. We intentionally avoid a visible "refresh method" setting: the saved script's presence determines the path, while the UI explains the resolved path and keeps unsaved edits from appearing active until the schedule form is saved.

When a new Sandbox profile version is published, version-scoped refresh settings are copied forward from the previous version. That includes the Snapshot maintenance script and refresh schedule configuration. Snapshot image state, in-progress jobs, and schedule cursor state are not copied; the new published version still creates its own initial setup snapshot, and copied schedules recompute their next occurrence from publish time.

## Consequences

- Published sandbox profile versions have one intentionally mutable field: the Snapshot maintenance script.
- A scheduled refresh may run a different script than the one present when the schedule became due if the Snapshot maintenance script is edited before execution.
- Snapshot maintenance script test runs start from the existing usable Snapshot and do not replace it.
- The first implementation keeps the database model small and can add job-level script capture later if execution-time races become a problem.
- Automatic snapshot refresh remains the only scheduled-refresh setting; the UI should not add a separate refresh-method control.
- Disabling Automatic snapshot refresh does not delete the saved Snapshot maintenance script.
- Manual Snapshot maintenance script refresh should be presented with Automatic snapshot refresh and only when the saved script can actually be used.
- Refresh settings follow newly published versions without carrying over old snapshot images or active jobs.
- Copied schedules keep their definition but do not replay stale due work from the previous version.
