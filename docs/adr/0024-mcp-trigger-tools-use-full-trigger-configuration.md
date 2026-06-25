# MCP trigger tools use full trigger configuration

MCP trigger tools should expose **Trigger configuration** as the canonical read and write surface: `list_triggers` remains a summary tool, while `get_trigger`, `create_trigger`, and `update_trigger` use full kind-discriminated trigger configuration with durable field names such as `inputTemplate`, `eventConditions`, and `target`. We choose this breaking shape over narrow convenience setters because agents need safe read-modify-write behavior, and partial tools such as event-type-only webhook updates can lose behavior-defining fields like payload filters.

## Consequences

- The narrow MCP trigger setter tools should be removed rather than kept as compatibility aliases.
- Discovery helpers such as `list_trigger_webhook_events` may remain because they do not provide an alternate mutation path.
- Omitted fields in `update_trigger` preserve existing values; explicit `null` clears nullable fields.
- Display/listing metadata remains on summary surfaces instead of the full configuration contract.
- Nested configuration objects should expose behavior fields rather than internal child row IDs such as target or schedule row identifiers.
- `create_trigger`, `update_trigger`, and `get_trigger` should return the same full configuration response shape, including behavior-relevant schedule state.

## Trade-off

This favors agent-safe trigger ownership over compatibility and small tool schemas. Simple caller workflows become more verbose and existing narrow MCP callers must migrate, but agents get one behavior-preserving lifecycle surface and avoid known footguns such as event-type-only webhook updates dropping payload filters.
