import { describe, expect, it } from "vitest";

import { parseOrganizationSummary } from "./organization-summary-payload.js";

describe("parseOrganizationSummary", () => {
  it("returns organization summary for valid payload", () => {
    const result = parseOrganizationSummary({
      id: "org_123",
      name: "Acme",
      logo: "https://control-plane.test/v1/media/organizations/org_123/logo",
      slug: "acme",
    });

    expect(result).toEqual({
      name: "Acme",
      logoUrl: "https://control-plane.test/v1/media/organizations/org_123/logo",
    });
  });

  it("throws when required name is missing", () => {
    expect(() => {
      parseOrganizationSummary({
        id: "org_123",
        slug: "acme",
      });
    }).toThrow("Organization name was missing.");
  });

  it("returns null logo when payload does not include one", () => {
    const result = parseOrganizationSummary({
      id: "org_123",
      name: "Acme",
      slug: "acme",
    });

    expect(result).toEqual({
      name: "Acme",
      logoUrl: null,
    });
  });
});
