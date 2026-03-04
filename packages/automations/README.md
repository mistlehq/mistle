# @mistle/automations

Shared automation contracts and evaluation helpers.

This package is provider-agnostic. It defines reusable filter semantics that can
be consumed by multiple apps (for example `control-plane-api` and `dashboard`)
without duplicating logic.

## Current scope

The initial scope is webhook payload filtering:

- Strongly typed filter AST (`WebhookPayloadFilter`)
- Runtime validation (`WebhookPayloadFilterSchema`)
- Parse helper (`parseWebhookPayloadFilter`)
- Deterministic evaluator (`evaluateWebhookPayloadFilter`)
- Payload path resolver (`getWebhookPayloadValueAtPath`)

## Exports

From the package root:

- `WebhookPayloadFilter`
- `WebhookPayloadFilterSchema`
- `parseWebhookPayloadFilter(...)`
- `evaluateWebhookPayloadFilter(...)`
- `getWebhookPayloadValueAtPath(...)`
- `and(...)`, `or(...)`, `not(...)`
- `eq(...)`, `neq(...)`, `inList(...)`
- `contains(...)`, `startsWith(...)`, `endsWith(...)`
- `exists(...)`, `notExists(...)`
- `path(...)`

Subpath export:

- `@mistle/automations/webhook-filter`

## Filter model

Paths are represented as string segment arrays, not dot-delimited strings.

Example path:

- `[
  "comment",
  "body"
]`

Supported operators:

- Composition: `and`, `or`, `not`
- Scalar comparisons: `eq`, `neq`, `in`
- String checks: `contains`, `starts_with`, `ends_with`
- Presence checks: `exists`, `not_exists`

Parser compatibility aliases:

- `all` is accepted and normalized to `and`
- `any` is accepted and normalized to `or`

## Example

```ts
import { evaluateWebhookPayloadFilter, parseWebhookPayloadFilter } from "@mistle/automations";

const filter = parseWebhookPayloadFilter({
  op: "and",
  filters: [
    { op: "eq", path: ["action"], value: "created" },
    {
      op: "contains",
      path: ["comment", "body"],
      value: "@mistlebot",
    },
  ],
});

const matches = evaluateWebhookPayloadFilter({
  filter,
  payload: {
    action: "created",
    comment: {
      body: "hello @mistlebot",
    },
  },
});

// matches === true
```

## Helper functions

The package includes constructor helpers for building webhook payload filters:

- `and(filters)`
- `or(filters)`
- `not(filter)`
- `eq(path, value)`
- `neq(path, value)`
- `inList(path, values)`
- `contains(path, value)`
- `startsWith(path, value)`
- `endsWith(path, value)`
- `exists(path)`
- `notExists(path)`
- `path(input)` for converting dot-delimited paths like `"comment.body"` to
  segment arrays like `["comment", "body"]`

Example usage:

```ts
import { and, contains, eq, evaluateWebhookPayloadFilter, path } from "@mistle/automations";

const filter = and([eq(path("action"), "created"), contains(path("comment.body"), "@mistlebot")]);

const matches = evaluateWebhookPayloadFilter({
  filter,
  payload: {
    action: "created",
    comment: {
      body: "hello @mistlebot",
    },
  },
});

// matches === true
```

## Path semantics

- Object traversal uses exact property names.
- Array traversal uses numeric string segments (for example `"0"`, `"1"`).
- Missing paths resolve to `undefined`.
- `exists` and `not_exists` operate on that `undefined` behavior.

## Notes

- This package intentionally does not include provider-specific webhook
  normalization. That belongs in integration packages.
- This package intentionally does not include UI-specific rule-builder mapping.
  UI adapters should live in the consuming app.
