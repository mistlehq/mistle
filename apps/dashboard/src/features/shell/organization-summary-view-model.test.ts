import { describe, expect, it } from "vitest";

import { resolveOrganizationSummaryViewModel } from "./organization-summary-view-model.js";

describe("resolveOrganizationSummaryViewModel", () => {
  it("returns loading state while pending", () => {
    const result = resolveOrganizationSummaryViewModel({
      isPending: true,
      isError: false,
      error: null,
      organizationName: null,
      organizationLogoUrl: null,
    });

    expect(result).toEqual({
      organizationName: "",
      organizationLogoUrl: null,
      organizationErrorMessage: null,
    });
  });

  it("returns fallback unavailable state and message when query errors", () => {
    const result = resolveOrganizationSummaryViewModel({
      isPending: false,
      isError: true,
      error: new Error("Session expired."),
      organizationName: null,
      organizationLogoUrl: null,
    });

    expect(result).toEqual({
      organizationName: "Organization unavailable",
      organizationLogoUrl: null,
      organizationErrorMessage: "Session expired.",
    });
  });

  it("returns default error message when error has no message", () => {
    const result = resolveOrganizationSummaryViewModel({
      isPending: false,
      isError: true,
      error: null,
      organizationName: null,
      organizationLogoUrl: null,
    });

    expect(result).toEqual({
      organizationName: "Organization unavailable",
      organizationLogoUrl: null,
      organizationErrorMessage: "Could not load organization.",
    });
  });

  it("returns organization name when query succeeds", () => {
    const result = resolveOrganizationSummaryViewModel({
      isPending: false,
      isError: false,
      error: null,
      organizationName: "Acme",
      organizationLogoUrl: "https://control-plane.test/v1/media/organizations/org_123/logo",
    });

    expect(result).toEqual({
      organizationName: "Acme",
      organizationLogoUrl: "https://control-plane.test/v1/media/organizations/org_123/logo",
      organizationErrorMessage: null,
    });
  });
});
