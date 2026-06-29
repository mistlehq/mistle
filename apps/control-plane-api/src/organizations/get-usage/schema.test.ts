import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { OrganizationUsageQuerySchema } from "./schema.js";

describe("OrganizationUsageQuerySchema", () => {
  it("accepts calendar months using YYYY-MM format", () => {
    expect(
      OrganizationUsageQuerySchema.safeParse({
        month: "2026-12",
      }).success,
    ).toBe(true);
  });

  it("rejects month values outside the calendar range", () => {
    expect(
      OrganizationUsageQuerySchema.safeParse({
        month: "2026-13",
      }).success,
    ).toBe(false);
  });

  it("emits the calendar month range without JavaScript regex flags in OpenAPI", () => {
    const spec = JSON.parse(readFileSync("openapi/control-plane.v1.json", "utf8")) as {
      paths?: {
        "/v1/organization/usage"?: {
          get?: {
            parameters?: unknown;
          };
        };
      };
    };
    const parameters = spec.paths?.["/v1/organization/usage"]?.get?.parameters;
    if (!Array.isArray(parameters)) {
      throw new Error("Organization usage OpenAPI parameters were not found.");
    }

    expect(parameters).toContainEqual({
      schema: {
        type: "string",
        pattern: "^\\d{4}-(0[1-9]|1[0-2])$",
      },
      required: true,
      name: "month",
      in: "query",
    });
  });
});
