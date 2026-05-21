# Account Linking

Account linking lets users connect their Mistle account to their identity in a supported integration provider, such as Slack or GitHub.

Organizations can enable supported integrations as OAuth account-linking providers. Each enabled provider configuration points at one integration connection, so the same provider family can be configured more than once when the underlying provider has separate workspaces or apps. For example, one Slack app can be installed in an engineering workspace while another Slack app is installed in a support workspace.

Once linked, Mistle can map provider activity back to the correct Mistle user, so actions, workflow runs, and agent work are attributed to the right person. Resolution is scoped to the configured integration connection, not only the provider family. A Slack webhook from one workspace must resolve only linked principals for that workspace's provider configuration, even if another workspace has the same Slack user ID.

## Example Flow

In this example, a user asks an agent to do work from Slack. The agent completes the work and opens a pull request in GitHub. Account linking lets Mistle connect the Slack message, the Mistle user, and the GitHub identity involved in the resulting work.

```text
┌────────────┐
│   Slack    │
│            │
│ User sends │
│ a message  │
└─────┬──────┘
      │ Slack user ID
      ▼
┌──────────────────────┐
│        Mistle        │
│                      │
│ Resolve Slack user   │
│ to linked Mistle     │
│ user account         │
└─────┬────────────────┘
      │ Mistle user ID
      ▼
┌──────────────────────┐
│    Agent Workflow    │
│                      │
│ Run work with the    │
│ right requester and  │
│ organization context │
└─────┬────────────────┘
      │ GitHub connection / linked identity
      ▼
┌────────────┐
│   GitHub   │
│            │
│ Agent opens│
│ a pull     │
│ request    │
└─────┬──────┘
      │ PR metadata / events
      ▼
┌──────────────────────┐
│        Mistle        │
│                      │
│ Attribute the work   │
│ back to the correct  │
│ Mistle user          │
└──────────────────────┘
```

Without account linking, Mistle may know that a Slack user triggered work and that a GitHub connection opened a pull request, but it cannot reliably prove those identities belong to the same person.
