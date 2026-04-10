import { describe, expect, it } from "vitest";

import { parseInvitationsPage } from "./members-invitations-page-parser.js";

describe("invitations page parser", () => {
  it("parses invitation entries into the existing invitation model", () => {
    const parsed = parseInvitationsPage({
      invitations: [
        {
          id: "inv_123",
          organizationId: "org_123",
          email: "invitee@example.com",
          role: "member",
          inviterId: "user_inviter",
          inviterName: "Inviter Example",
          status: "pending",
          expiresAt: "2026-03-10T00:00:00.000Z",
          createdAt: "2026-03-04T00:00:00.000Z",
        },
      ],
      limit: 25,
      offset: 0,
      total: 1,
    });

    expect(parsed.invitations).toEqual([
      {
        id: "inv_123",
        organizationId: "org_123",
        email: "invitee@example.com",
        role: "member",
        inviterId: "user_inviter",
        inviterName: "Inviter Example",
        status: "pending",
        expiresAt: "2026-03-10T00:00:00.000Z",
        createdAt: "2026-03-04T00:00:00.000Z",
      },
    ]);
    expect(parsed.limit).toBe(25);
    expect(parsed.offset).toBe(0);
    expect(parsed.total).toBe(1);
  });

  it("throws when pagination metadata is missing", () => {
    expect(() =>
      parseInvitationsPage({
        invitations: [],
        offset: 0,
        total: 0,
      }),
    ).toThrow("Invitations page response did not include valid pagination metadata.");
  });
});
