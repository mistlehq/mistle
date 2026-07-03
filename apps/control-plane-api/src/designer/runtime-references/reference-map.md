# Designer Runtime Reference Map

Runtime reference root: `.mistle/designer/references/`

Use this map to find local reference files before broad tool discovery. Prefer `rg` over reading a full directory when resolving integration metadata.

## Files

- `reference-map.md`: this filesystem guide.
- `workflow-patterns/ai-software-factory.md`: workflow reference for AI software factory, issue-to-PR factory, autonomous coding, and similar software-delivery workflows.
- `integrations/index.md`: compact generated integration lookup file. Use this only when search does not immediately identify a detail file.
- `integrations/<integration-target-key>.md`: generated detail file for one integration target. Read the matching detail file before configuring App setup, bindings, resources, provider tools, triggers, webhook template fields, or agent model-provider bindings.

## Integration Lookup

Search `.mistle/designer/references/integrations/` with `rg` for the provider display name, provider family id, integration target key, setup method id, binding tool id, resource kind, or trigger event type. After a match, read only the matching `integrations/<integration-target-key>.md` file.

If the local integration reference is missing, stale, ambiguous, or insufficient for the supported behavior you need to confirm, use `list_supported_capabilities` before broader integration discovery.
