# Provider-Defined Trigger Event Parameter Groups

Webhook trigger event definitions may declare one-of Trigger event parameter groups that reference existing Trigger event parameters. The dashboard uses those groups for generic trigger-parameter rendering and for serialization and hydration constraints, while the underlying Trigger event parameter rules remain keyed by the referenced parameter ids.

We place this semantic grouping in integration definitions because provider webhook payloads can represent one logical trigger-matching choice through multiple payload paths. Keeping that relationship in dashboard-specific code splits the provider event model across packages and makes each new provider-specific grouped control require another dashboard special case.

## Consequences

- Trigger event parameter groups add structure over existing Trigger event parameters instead of inlining duplicate parameter definitions.
- Grouped parameters are not rendered as independent standalone controls when a group references them.
- A one-of group means one active parameter option in the trigger builder; a blank active option still produces no Trigger event parameter rule.
- Unsupported or inconsistent group metadata should fail explicitly instead of falling back to independent parameter rendering.
