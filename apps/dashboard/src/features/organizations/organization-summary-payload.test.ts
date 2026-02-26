import { describe, expect, it } from "vitest";

import { parseOrganizationSummary } from "./organization-summary-payload.js";

describe("parseOrganizationSummary", () => {
  it("returns organization summary for valid payload", () => {
    const result = parseOrganizationSummary({
      id: "org_123",
      name: "Acme",
      slug: "acme",
    });

    expect(result).toEqual({
      name: "Acme",
      slug: "acme",
    });
  });

  it("throws when required fields are missing", () => {
    expect(() => {
      parseOrganizationSummary({
        id: "org_123",
      });
    }).toThrow("Organization fields were missing.");
  });
});
