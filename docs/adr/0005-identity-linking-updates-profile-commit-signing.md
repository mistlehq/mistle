# Identity Linking Updates Profile Commit Signing

Git commit signing remains a Sandbox profile version setting, but Git identity-linking changes apply matching profile signing updates in the same transaction. When a Git connection becomes identity-linked, current active and draft Sandbox profile versions that use that same Git connection have Git commit signing enabled by setting the signing connection to that Git connection. When identity linking is disabled for a Git connection, current active and draft versions that sign with that connection have Git commit signing disabled by clearing the signing connection.

The product supports a 1:1 relationship between a profile version's Git connection and its Git commit signing connection. A profile version using one Git connection while signing through a different Git connection violates that invariant. Identity-linking changes should capture and report invariant violations as bugs, but should not block saving the organization identity-linking change or silently rewrite the mismatched value.

This keeps profile signing state explicit, avoids treating a null signing connection as implicit allowed behavior, and avoids requiring a profile publish, new version, or new Snapshot for commit-signing availability changes. The tradeoff is that organization identity-linking writes intentionally update current profile-version metadata, so the UI must preview and report the affected Sandbox profiles.

Existing profile versions with a null Git commit signing connection are not backfilled by a migration. Any historical profiles that should keep commit signing enabled will be handled manually, and the application only applies this synchronization on future identity-linking enable, disable, or connection-change writes.
