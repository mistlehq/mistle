import { describe, expect, it } from "vitest";

import { buildOrganizationName } from "./organization.js";

describe("organization helpers", () => {
  it("builds organization name from user name", () => {
    expect(buildOrganizationName("  Jane Doe  ")).toBe("Jane Doe's organization");
    expect(buildOrganizationName(" ")).toBe("Default Organization");
  });
});
