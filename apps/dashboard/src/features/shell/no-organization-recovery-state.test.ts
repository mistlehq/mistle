import { describe, expect, it } from "vitest";

import { resolveNoOrganizationRecoveryViewState } from "./no-organization-recovery-state.js";

describe("resolveNoOrganizationRecoveryViewState", () => {
  it("returns loading while query is pending", () => {
    expect(
      resolveNoOrganizationRecoveryViewState({
        isPending: true,
        isError: false,
        hasPendingInvitations: false,
      }),
    ).toBe("loading");
  });

  it("returns error when invitations query fails", () => {
    expect(
      resolveNoOrganizationRecoveryViewState({
        isPending: false,
        isError: true,
        hasPendingInvitations: false,
      }),
    ).toBe("error");
  });

  it("returns pending when invitations exist and query succeeds", () => {
    expect(
      resolveNoOrganizationRecoveryViewState({
        isPending: false,
        isError: false,
        hasPendingInvitations: true,
      }),
    ).toBe("pending");
  });

  it("returns empty when query succeeds without invitations", () => {
    expect(
      resolveNoOrganizationRecoveryViewState({
        isPending: false,
        isError: false,
        hasPendingInvitations: false,
      }),
    ).toBe("empty");
  });
});
