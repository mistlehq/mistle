import { describe, expect, it } from "vitest";

import {
  formatInvitationRole,
  isInvitationFetchDifferentAccountError,
  parseInvitationDetails,
  toInvitationFetchErrorMessage,
  toInvitationMutationErrorMessage,
} from "./invitation-accept-state.js";

describe("invitation accept state", () => {
  it("parses invitation details payload", () => {
    const parsed = parseInvitationDetails({
      id: "inv_123",
      email: "user@example.com",
      role: "member",
      organizationId: "org_123",
      inviterId: "user_999",
      status: "pending",
      expiresAt: "2026-02-27T00:00:00.000Z",
      organizationName: "Mistle",
      inviterEmail: "owner@example.com",
    });

    expect(parsed).toEqual({
      id: "inv_123",
      email: "user@example.com",
      role: "member",
      organizationId: "org_123",
      inviterId: "user_999",
      status: "pending",
      expiresAt: "2026-02-27T00:00:00.000Z",
      organizationName: "Mistle",
      inviterEmail: "owner@example.com",
    });
  });

  it("returns null for malformed invitation payload", () => {
    expect(parseInvitationDetails({ id: "inv_123" })).toBeNull();
  });

  it("parses invitation payload without optional metadata fields", () => {
    const parsed = parseInvitationDetails({
      id: "inv_123",
      email: "user@example.com",
      role: "member",
      organizationId: "org_123",
      inviterId: "user_999",
      status: "pending",
      expiresAt: "2026-02-27T00:00:00.000Z",
    });

    expect(parsed).toEqual({
      id: "inv_123",
      email: "user@example.com",
      role: "member",
      organizationId: "org_123",
      inviterId: "user_999",
      status: "pending",
      expiresAt: "2026-02-27T00:00:00.000Z",
      organizationName: null,
      inviterEmail: null,
    });
  });

  it("parses nested invitation payload", () => {
    const parsed = parseInvitationDetails({
      invitation: {
        id: "inv_123",
        email: "user@example.com",
        role: "member",
        organizationId: "org_123",
        inviterId: "user_999",
        status: "pending",
        expiresAt: "2026-02-27T00:00:00.000Z",
      },
      organization: {
        name: "Mistle",
        slug: "mistle",
      },
      inviter: {
        user: {
          email: "owner@example.com",
        },
      },
    });

    expect(parsed).toEqual({
      id: "inv_123",
      email: "user@example.com",
      role: "member",
      organizationId: "org_123",
      inviterId: "user_999",
      status: "pending",
      expiresAt: "2026-02-27T00:00:00.000Z",
      organizationName: "Mistle",
      inviterEmail: "owner@example.com",
    });
  });

  it("maps fetch errors by status", () => {
    expect(toInvitationFetchErrorMessage({ status: 401 })).toBe("Please sign in to continue.");
    expect(toInvitationFetchErrorMessage({ status: 403 })).toBe(
      "This invitation belongs to a different account.",
    );
    expect(toInvitationFetchErrorMessage({ status: 400 })).toBe(
      "This invitation is invalid, expired, or no longer pending.",
    );
  });

  it("identifies different-account fetch errors", () => {
    expect(isInvitationFetchDifferentAccountError({ status: 403 })).toBe(true);
    expect(isInvitationFetchDifferentAccountError({ status: 400 })).toBe(false);
  });

  it("maps mutation errors by action", () => {
    expect(toInvitationMutationErrorMessage({ status: 401 }, "accept")).toBe(
      "Please sign in to continue.",
    );
    expect(toInvitationMutationErrorMessage({ status: 403 }, "reject")).toBe(
      "You are not allowed to modify this invitation.",
    );
    expect(toInvitationMutationErrorMessage({ status: 400 }, "accept")).toBe(
      "This invitation is no longer available.",
    );
    expect(toInvitationMutationErrorMessage({ message: "boom" }, "reject")).toBe("boom");
  });

  it("formats invitation roles for display", () => {
    expect(formatInvitationRole("owner")).toBe("Owner");
    expect(formatInvitationRole("admin")).toBe("Admin");
    expect(formatInvitationRole("member")).toBe("Member");
    expect(formatInvitationRole("custom_role")).toBe("custom_role");
  });
});
