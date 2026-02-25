import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createKeysetPaginationEnvelopeSchema,
  createKeysetPaginationQuerySchema,
} from "./schemas.js";

describe("createKeysetPaginationQuerySchema", () => {
  it("applies defaults and parses limit values", () => {
    const schema = createKeysetPaginationQuerySchema();
    expect(schema.parse({})).toEqual({
      limit: 20,
    });

    expect(
      schema.parse({
        limit: "5",
      }),
    ).toEqual({
      limit: 5,
    });
  });

  it("rejects when both after and before are provided", () => {
    const schema = createKeysetPaginationQuerySchema();
    expect(() =>
      schema.parse({
        after: "cursor-a",
        before: "cursor-b",
      }),
    ).toThrowError("Only one of `after` or `before` can be provided.");
  });
});

describe("createKeysetPaginationEnvelopeSchema", () => {
  it("builds a typed envelope schema", () => {
    const schema = createKeysetPaginationEnvelopeSchema(
      z
        .object({
          id: z.string(),
        })
        .strict(),
    );

    expect(
      schema.parse({
        totalResults: 1,
        items: [
          {
            id: "item_1",
          },
        ],
        nextPage: {
          after: "cursor_1",
          limit: 20,
        },
        previousPage: null,
      }),
    ).toEqual({
      totalResults: 1,
      items: [
        {
          id: "item_1",
        },
      ],
      nextPage: {
        after: "cursor_1",
        limit: 20,
      },
      previousPage: null,
    });
  });
});
