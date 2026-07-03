# Provider resource sync failures are classified at the provider boundary

Provider resource sync can fail because a supported resource kind has not been refreshed, because provider credentials are invalid, or because the provider denies access to that specific resource kind. Provider-specific resource listing code should classify clear provider responses into typed resource sync failures, such as permission denial or credential failure, and the sync worker should preserve those classifications instead of inferring them from provider messages later.

## Consequences

- GitHub, Slack, Discord, and future integrations own the mapping from provider responses to Mistle resource sync failure categories.
- The shared sync worker preserves typed resource sync failure codes and messages, but does not parse provider-specific status text.
- Resource-backed controls can distinguish **Resource sync permission denial** from initial sync prerequisites and generic sync failures.
