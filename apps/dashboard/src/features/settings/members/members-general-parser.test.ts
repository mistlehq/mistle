import { describe, expect, it } from "vitest";

import { parseOrganizationSlugAvailability } from "./members-general-parser.js";

describe("members general parser", () => {
  it("parses slug availability from status and available keys", () => {
    expect(parseOrganizationSlugAvailability({ status: true })).toBe(true);
    expect(parseOrganizationSlugAvailability({ available: false })).toBe(false);
  });

  it("throws when slug availability response is invalid", () => {
    expect(() => parseOrganizationSlugAvailability(null)).toThrowError(
      "Organization slug response was invalid.",
    );
    expect(() => parseOrganizationSlugAvailability({})).toThrowError(
      "Organization slug response was missing availability.",
    );
    expect(() => parseOrganizationSlugAvailability({ status: "yes" })).toThrowError(
      "Organization slug response was missing availability.",
    );
  });
});
