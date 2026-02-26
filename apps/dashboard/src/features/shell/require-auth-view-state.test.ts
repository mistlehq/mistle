import { describe, expect, it } from "vitest";

import { resolveRequireAuthViewState } from "./require-auth-view-state.js";

describe("resolveRequireAuthViewState", () => {
  it("returns loading while session request is pending", () => {
    expect(
      resolveRequireAuthViewState({
        isLoading: true,
        errorMessage: null,
        hasSession: false,
        hasActiveOrganization: false,
      }),
    ).toBe("loading");
  });

  it("returns error when session request fails", () => {
    expect(
      resolveRequireAuthViewState({
        isLoading: false,
        errorMessage: "Unable to load session.",
        hasSession: false,
        hasActiveOrganization: false,
      }),
    ).toBe("error");
  });

  it("returns unauthenticated when session is missing", () => {
    expect(
      resolveRequireAuthViewState({
        isLoading: false,
        errorMessage: null,
        hasSession: false,
        hasActiveOrganization: false,
      }),
    ).toBe("unauthenticated");
  });

  it("returns missing-organization when authenticated session has no active organization", () => {
    expect(
      resolveRequireAuthViewState({
        isLoading: false,
        errorMessage: null,
        hasSession: true,
        hasActiveOrganization: false,
      }),
    ).toBe("missing-organization");
  });

  it("returns authenticated when session and active organization are present", () => {
    expect(
      resolveRequireAuthViewState({
        isLoading: false,
        errorMessage: null,
        hasSession: true,
        hasActiveOrganization: true,
      }),
    ).toBe("authenticated");
  });
});
