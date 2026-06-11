# Provider App Manifests Declare Resource Discovery Capabilities

Provider app manifests are user-visible setup artifacts, so Mistle must not silently add provider permissions after the user reviews them. Resource discovery capabilities that require extra provider permissions, such as GitHub team discovery from organization teams and org-wide GitHub App bot discovery from organization installations, should be inferred from the submitted manifest permissions rather than hidden server mutation or separate setup UI. The default visible GitHub App organization manifest should include the GitHub organization permissions needed for team and installed app discovery so newly created organization apps can sync GitHub team review target and GitHub App bot review target resources.

## Consequences

- Conditional provider permissions must appear in the visible **Provider app manifest** before submission. The GitHub App manifest setup flow should default to organization setup with an organization-ready manifest loaded, and switching the owner selection to personal setup should swap the visible manifest to the personal variant without organization-only permissions.
- Setup handlers may validate the submitted manifest but should not silently broaden it.
- GitHub App bot review target discovery can use organization installation inventory only when the submitted manifest declares the required GitHub organization permission.
- GitHub App bot review target resource sync should inspect only organizations that own repositories already accessible to the connection, not every organization the user or app could enumerate.
- GitHub installation repository-change webhooks should refresh bot resources because the accessible repository owners define the organization set inspected for bots.
- GitHub App bot review target resources should deduplicate by bot login/app identity, use GitHub app id as the external id, and merge organization and installation metadata when the same app appears in multiple accessible organizations.
- Trigger-builder controls that consume synced GitHub App bot review target resources can ship separately from the manifest and resource-sync support.
