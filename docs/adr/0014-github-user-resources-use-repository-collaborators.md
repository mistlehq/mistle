# GitHub User Resources Use Repository Collaborators

GitHub user resources represent human GitHub accounts with access to repositories accessible by an integration connection, so they are discovered from repository collaborators rather than commit contributors, organization members, free-form logins, or observed webhook actors. This keeps human actor and requested-reviewer trigger filters backed by repository access while avoiding the false precision of contributor history or organization-wide membership.

## Consequences

- Contributor-backed GitHub user discovery should be replaced rather than retained as a separate contributor resource.
- First-pass GitHub user discovery requires a GitHub App installation connection; API-key connections are not used because they can see repositories that cannot safely enumerate collaborators.
- GitHub App bot identities remain separate from GitHub user resources.
- GitHub user sync should fail rather than expose a partial collaborator snapshot when any provider collaborator listing fails.
- Organization-owned GitHub App manifests subscribe to organization membership and team-access events because those events can change the collaborator-backed user set.
