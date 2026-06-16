# Writing a New Integration

Use this guide when adding a new integration family, variant, target, hosted MCP
connector, model provider, sandbox runtime, or other public integration surface.

## References

- [`packages/integrations-core/README.md`](../../packages/integrations-core/README.md)
  covers targets, connections, bindings, runtime-plan compilation, managed
  egress, and `IntegrationDefinition`.
- [`docs/integrations.md`](../integrations.md) describes the product-level
  integration model and links to provider setup guidance.
- [`docs/adr/0015-prefer-hosted-provider-mcp-servers.md`](../adr/0015-prefer-hosted-provider-mcp-servers.md)
  prefers official hosted provider MCP servers when they fit Mistle's OAuth,
  credential, and egress model.
- [`docs/adr/0018-cloudwatch-mcp-runtime-artifact.md`](../adr/0018-cloudwatch-mcp-runtime-artifact.md)
  covers the pinned local MCP runtime artifact path when hosted MCP is not the
  right delivery mode.

## Decision Guide

Choose the closest existing pattern first, then make the provider-specific
decisions explicit.

1. Decide whether the capability is official provider functionality or a
   Mistle-maintained wrapper around provider APIs.
2. If the provider has an official hosted MCP server and it fits Mistle's OAuth,
   credential, and managed-egress model, prefer it.
3. If hosted MCP does not fit, decide whether a pinned local runtime artifact is
   justified. This changes install lifecycle, credential behavior,
   runtime-plan shape, and operational support.
4. If neither MCP path fits, decide whether the integration should instead be an
   API, CLI, webhook, model-provider, or sandbox-runtime integration.
5. Decide where configuration and credentials belong: operator-managed target
   config/secrets, organization connection credentials, binding config, or no
   user-supplied configuration.
6. Decide whether the integration is public enough to require dashboard assets,
   public docs, self-hosted target documentation, and an integration target
   manifest entry.

When the choice depends on provider behavior, verify that behavior from official
docs or live provider metadata before implementation. Important facts include
canonical endpoint URLs, auth methods, OAuth metadata, dynamic-client
registration behavior, redirect restrictions, token refresh support, the MCP
protected-resource identifier, and whether API tokens can access the intended
endpoint.

Do not assume the MCP transport URL and OAuth resource identifier are the same.
Use the provider's protected-resource metadata when the integration depends on
OAuth resource/audience values.

## Existing Patterns

| Integration shape             | References                                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| Hosted MCP with OAuth         | `src/sentry/variants/sentry-mcp`, `src/gcp/variants/gcp-mcp`                                       |
| Hosted MCP with API token     | `src/cloudflare/variants/cloudflare-mcp`                                                           |
| Multi-server MCP catalog      | `src/gcp/variants/gcp-mcp`, `src/cloudflare/variants/cloudflare-mcp`                               |
| Model provider                | `src/openrouter/variants/openrouter-default`, `src/fireworks`, `src/kimi`                          |
| Sandbox runtime provider      | `src/sandbox-runtimes/e2b`, `src/sandbox-runtimes/tensorlake`, `src/sandbox-runtimes/opencomputer` |
| Webhook or resource connector | `src/linear`, `integration/linear-webhook-source.integration.test.ts`                              |

If the provider's auth model or delivery mode differs from the closest
reference, follow the decision guide and make the difference explicit.

## Common Places To Touch

Use this as a file map, not a mandatory checklist.

- Integration definition source under `packages/integrations-definitions/src`.
- Browser/server/index registry exports in `src/browser.ts`, `src/server.ts`,
  and `src/index.ts` when the integration participates in those registries.
- `integration-targets.json` and the target sync path when the integration is
  operator-exposed as a target.
- Dashboard logo assets under `apps/dashboard/public/integration-logos` when
  the integration is shown in the app.
- Docs logo assets under `packages/docs/icons/integrations`, docs guide pages,
  and `packages/docs/docs.json` when the integration is public.
- Self-hosted integration target documentation when operators must understand
  target config or provisioning behavior.

## Logo Assets

Use provider-identifiable assets from a traceable source. Do not create or
approximate provider logos from memory.

Preferred sources, in order:

1. Official provider brand assets or official provider documentation assets.
2. [SVGL](https://github.com/pheralb/svgl) when it has the provider mark and an
   official source is unavailable or unsuitable for the app/docs slot.

If neither an official asset nor SVGL is suitable, flag that before adding an
asset.
