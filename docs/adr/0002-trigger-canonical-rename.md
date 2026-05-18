# Trigger Canonical Rename

We will use Trigger as the canonical term for configured event and schedule entrypoints across product language, API contracts, persistence, and workflow code. The earlier split that kept Automation for backend records made the dashboard, generated API schemas, database tables, scheduled-action payloads, and workflow language speak different models for the same concept.

The rename should ship as one atomic breaking change rather than a staged compatibility layer: dashboard routes and parameters, backend routes and schemas, database tables and columns, source modules, persisted trigger-domain enum values, and newly generated identifier prefixes should all use trigger language. Existing row identifiers keep their historical prefixes, and durable workflow identifiers are the only expected compatibility exception if OpenWorkflow requires old names for in-flight work.

## Consequences

- Existing automation-named database tables and columns become trigger-named through in-place PostgreSQL renames.
- Public API routes and response fields move from automation language to trigger language without compatibility aliases by default.
- Scheduled-action target types and payload fields that represent trigger runs move from automation language to trigger language.
- New Trigger, Trigger run, and Trigger target identifiers use `trg`, `trn`, and `tgt` prefixes respectively; existing `atm`, `aru`, and `atg` identifiers remain historical row IDs.
- Durable OpenWorkflow names and v1 side-effect step names remain on the existing automation-named strings so queued or running workflow rows continue to have registered handlers and stable step replay keys after deploy.
- Existing neutral conversation prefixes such as `cnv` and `cdt` stay unchanged for new records.
- Historical migrations and old logs remain historical artifacts and are not rewritten only for terminology.
