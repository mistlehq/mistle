import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import {
  createKeysetPageSizeSchema,
  getKeysetPaginationLimits,
  parseKeysetPageSize,
} from "./page-size.js";

describe("getKeysetPaginationLimits", () => {
  it("returns defaults when options are omitted", () => {
    expect(getKeysetPaginationLimits(undefined)).toEqual({
      defaultLimit: 20,
      maxLimit: 100,
    });
  });

  it("rejects invalid option bounds", () => {
    expect(() =>
      getKeysetPaginationLimits({
        defaultLimit: 0,
      }),
    ).toThrow("Keyset pagination `defaultLimit` must be an integer greater than 0.");

    expect(() =>
      getKeysetPaginationLimits({
        maxLimit: 0,
      }),
    ).toThrow("Keyset pagination `maxLimit` must be an integer greater than 0.");

    expect(() =>
      getKeysetPaginationLimits({
        defaultLimit: 50,
        maxLimit: 10,
      }),
    ).toThrow("Keyset pagination `defaultLimit` must be less than or equal to `maxLimit`.");
  });
});

describe("createKeysetPageSizeSchema", () => {
  it("applies default and validates upper bound", () => {
    const schema = createKeysetPageSizeSchema({
      defaultLimit: 10,
      maxLimit: 25,
    });

    expect(schema.parse(undefined)).toBe(10);
    expect(schema.parse(25)).toBe(25);
    expect(() => schema.parse(26)).toThrow(ZodError);
  });
});

describe("parseKeysetPageSize", () => {
  it("parses valid limit and applies default limit", () => {
    expect(parseKeysetPageSize(7, { defaultLimit: 5, maxLimit: 20 })).toBe(7);
    expect(parseKeysetPageSize(undefined, { defaultLimit: 5, maxLimit: 20 })).toBe(5);
  });

  it("throws zod errors on invalid limits", () => {
    expect(() => parseKeysetPageSize(0, { defaultLimit: 5, maxLimit: 20 })).toThrow(ZodError);
    expect(() => parseKeysetPageSize(21, { defaultLimit: 5, maxLimit: 20 })).toThrow(ZodError);
  });
});
