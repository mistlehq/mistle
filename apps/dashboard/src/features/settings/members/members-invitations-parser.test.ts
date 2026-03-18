import { describe, expect, it } from "vitest";

import {
  parseInvitation,
  parseInviteMemberResponse,
  parseInvitationsResponse,
} from "./members-invitations-parser.js";

describe("members invitations parser", () => {
  it("parses valid invitation payloads", () => {
    const parsed = parseInvitation({
      id: "inv_123",
      organizationId: "org_123",
      email: "invitee@example.com",
      role: "admin,member",
      inviterId: "user_inviter",
      status: "pending",
      expiresAt: "2026-03-01T00:00:00.000Z",
      createdAt: "2026-02-25T12:00:00.000Z",
    });

    expect(parsed).toEqual({
      id: "inv_123",
      organizationId: "org_123",
      email: "invitee@example.com",
      role: "admin",
      inviterId: "user_inviter",
      status: "pending",
      rawStatus: null,
      expiresAt: "2026-03-01T00:00:00.000Z",
      createdAt: "2026-02-25T12:00:00.000Z",
    });
  });

  it("returns null for invalid invitation payloads", () => {
    expect(parseInvitation(null)).toBeNull();
    expect(
      parseInvitation({
        id: "inv_123",
        organizationId: "org_123",
        email: "invitee@example.com",
        role: "viewer",
        inviterId: "user_inviter",
        status: "pending",
        expiresAt: "2026-03-01T00:00:00.000Z",
        createdAt: "2026-02-25T12:00:00.000Z",
      }),
    ).toBeNull();
  });

  it("parses invitation list responses and drops invalid records", () => {
    const parsed = parseInvitationsResponse([
      {
        id: "inv_1",
        organizationId: "org_123",
        email: "invitee@example.com",
        role: "member",
        inviterId: "user_inviter",
        status: "pending",
        expiresAt: "2026-03-01T00:00:00.000Z",
        createdAt: "2026-02-25T12:00:00.000Z",
      },
      {
        id: "inv_2",
        role: "viewer",
      },
    ]);

    expect(parsed).toEqual([
      {
        id: "inv_1",
        organizationId: "org_123",
        email: "invitee@example.com",
        role: "member",
        inviterId: "user_inviter",
        status: "pending",
        rawStatus: null,
        expiresAt: "2026-03-01T00:00:00.000Z",
        createdAt: "2026-02-25T12:00:00.000Z",
      },
    ]);
  });

  it("preserves unknown invitation statuses for downstream display mapping", () => {
    const parsed = parseInvitation({
      id: "inv_123",
      organizationId: "org_123",
      email: "invitee@example.com",
      role: "member",
      inviterId: "user_inviter",
      status: "custom_status",
      expiresAt: "2026-03-01T00:00:00.000Z",
      createdAt: "2026-02-25T12:00:00.000Z",
    });

    expect(parsed).toEqual({
      id: "inv_123",
      organizationId: "org_123",
      email: "invitee@example.com",
      role: "member",
      inviterId: "user_inviter",
      status: "unknown",
      rawStatus: "custom_status",
      expiresAt: "2026-03-01T00:00:00.000Z",
      createdAt: "2026-02-25T12:00:00.000Z",
    });
  });

  it("parses invite-member response metadata", () => {
    expect(
      parseInviteMemberResponse({
        status: "already_invited",
        error: {
          code: "already_invited",
          message: "Invitation already exists",
        },
      }),
    ).toEqual({
      status: "already_invited",
      message: "Invitation already exists",
      code: "already_invited",
      raw: {
        status: "already_invited",
        error: {
          code: "already_invited",
          message: "Invitation already exists",
        },
      },
    });
  });

  it("throws when invitation response is not an array", () => {
    expect(() => parseInvitationsResponse({})).toThrow(
      "Invitations response did not include an array.",
    );
  });
});
