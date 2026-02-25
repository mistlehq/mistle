# @mistle/http/pagination

Shared keyset pagination primitives for HTTP-facing list endpoints.

## Public API

### Schemas

- `createKeysetPaginationQuerySchema(options?)`
  - Builds a Zod query schema with `limit`, `after`, and `before`.
  - Enforces: only one of `after`/`before`, configurable `defaultLimit`/`maxLimit`.
- `createKeysetPaginationEnvelopeSchema(itemSchema, options?)`
  - Builds a response envelope schema:
  - `totalResults`, `items`, `nextPage`, `previousPage`.

### Page size utilities

- `createKeysetPageSizeSchema(options?)`
  - Zod schema for page size with default + max bound enforcement.
- `parseKeysetPageSize(limit, options?)`
  - Parses page size (or applies default) using Zod.
- `getKeysetPaginationLimits(options?)`
  - Resolves and validates `defaultLimit`/`maxLimit` configuration.

### Cursor utilities

- `encodeKeysetCursor(cursor)`
  - Serializes cursor payload to base64url.
- `decodeKeysetCursor({ encodedCursor, schema })`
  - Decodes and validates cursor payload with Zod.
- `decodeOptionalKeysetCursor({ encodedCursor, schema })`
  - Returns `undefined` when no cursor is provided.
- `decodeKeysetCursorOrThrow({ encodedCursor, cursorName, schema, mapDecodeError })`
  - Generic adapter to map low-level decode failures to domain-specific errors.

### Keyset pagination engine

- `paginateKeyset({ ... })`
  - Shared pagination flow:
  - validates `after`/`before` usage,
  - decodes cursor,
  - fetches `limitPlusOne`,
  - computes `nextPage`/`previousPage`,
  - returns typed `KeysetPaginatedResult<TItem>`.

- Supporting exports:
  - `KeysetPaginationDirections`
  - `KeysetPaginationInputError`
  - `KeysetPaginationInputErrorReasons`
  - `KeysetCursorDecodeError`
  - `KeysetCursorDecodeErrorReasons`

## Example: Query + Envelope Schemas

```ts
import { z } from "zod";
import {
  createKeysetPaginationEnvelopeSchema,
  createKeysetPaginationQuerySchema,
} from "@mistle/http/pagination";

const querySchema = createKeysetPaginationQuerySchema({
  defaultLimit: 20,
  maxLimit: 100,
});

const itemSchema = z.object({
  id: z.string().min(1),
});

const responseSchema = createKeysetPaginationEnvelopeSchema(itemSchema, {
  maxLimit: 100,
});
```

## Example: Cursor Decode Error Mapping

```ts
import { z } from "zod";
import { decodeKeysetCursorOrThrow, KeysetCursorDecodeErrorReasons } from "@mistle/http/pagination";

const cursorSchema = z.object({
  createdAt: z.string().min(1),
  id: z.string().min(1),
});

const cursor = decodeKeysetCursorOrThrow({
  encodedCursor: input.after,
  cursorName: "after",
  schema: cursorSchema,
  mapDecodeError: ({ cursorName, reason }) => {
    const reasonToMessage = {
      [KeysetCursorDecodeErrorReasons.INVALID_BASE64URL]: `\`${cursorName}\` cursor is not valid base64url.`,
      [KeysetCursorDecodeErrorReasons.INVALID_JSON]: `\`${cursorName}\` cursor does not contain valid JSON.`,
      [KeysetCursorDecodeErrorReasons.INVALID_SHAPE]: `\`${cursorName}\` cursor has an invalid shape.`,
    } as const;

    return new Error(reasonToMessage[reason]);
  },
});
```

## Example: Paginate a Resource

```ts
import { paginateKeyset, KeysetPaginationDirections } from "@mistle/http/pagination";

const result = await paginateKeyset({
  query: {
    after: input.after,
    before: input.before,
  },
  pageSize: 20,
  decodeCursor: ({ encodedCursor, cursorName }) =>
    decodeCursorForResource({ encodedCursor, cursorName }),
  encodeCursor: (cursor) => encodeResourceCursor(cursor),
  getCursor: (item) => ({
    createdAt: item.createdAt,
    id: item.id,
  }),
  fetchPage: ({ direction, cursor, limitPlusOne }) =>
    db.query.resource.findMany({
      where: (table, { and, eq, gt, lt, or }) => {
        const scope = eq(table.organizationId, input.organizationId);

        if (cursor === undefined) {
          return scope;
        }

        if (direction === KeysetPaginationDirections.FORWARD) {
          return and(
            scope,
            or(
              lt(table.createdAt, cursor.createdAt),
              and(eq(table.createdAt, cursor.createdAt), lt(table.id, cursor.id)),
            ),
          );
        }

        return and(
          scope,
          or(
            gt(table.createdAt, cursor.createdAt),
            and(eq(table.createdAt, cursor.createdAt), gt(table.id, cursor.id)),
          ),
        );
      },
      orderBy:
        direction === KeysetPaginationDirections.BACKWARD
          ? (table, { asc }) => [asc(table.createdAt), asc(table.id)]
          : (table, { desc }) => [desc(table.createdAt), desc(table.id)],
      limit: limitPlusOne,
    }),
  countTotalResults: () => countScopedRows(),
});
```
