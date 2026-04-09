import { describe, expect, it } from "vitest";

import { parseMembersDirectoryPage } from "./members-directory-page-parser.js";

describe("members directory page parser", () => {
  it("parses mixed directory entries into existing member and invitation models", () => {
    const parsed = parseMembersDirectoryPage({
      entries: [
        {
          kind: "invitation",
          id: "inv_123",
          organizationId: "org_123",
          email: "invitee@example.com",
          role: "member",
          inviterId: "user_inviter",
          status: "pending",
          rawStatus: null,
          expiresAt: "2026-03-10T00:00:00.000Z",
          createdAt: "2026-03-04T00:00:00.000Z",
        },
        {
          kind: "member",
          id: "mbr_123",
          userId: "user_member",
          name: "Member Example",
          email: "member@example.com",
          role: "admin",
          joinedAt: "2026-03-03T00:00:00.000Z",
          avatar: {
            hasImage: true,
            imageUrl: "https://example.com/avatar.webp",
          },
        },
      ],
      limit: 25,
      offset: 0,
      total: 2,
    });

    expect(parsed.members).toEqual([
      {
        id: "mbr_123",
        userId: "user_member",
        name: "Member Example",
        email: "member@example.com",
        role: "admin",
        joinedAt: "2026-03-03T00:00:00.000Z",
      },
    ]);
    expect(parsed.invitations).toEqual([
      {
        id: "inv_123",
        organizationId: "org_123",
        email: "invitee@example.com",
        role: "member",
        inviterId: "user_inviter",
        status: "pending",
        rawStatus: null,
        expiresAt: "2026-03-10T00:00:00.000Z",
        createdAt: "2026-03-04T00:00:00.000Z",
      },
    ]);
    expect(parsed.memberAvatarsByUserId.get("user_member")).toEqual({
      userId: "user_member",
      hasImage: true,
      imageUrl: "https://example.com/avatar.webp",
    });
    expect(parsed.limit).toBe(25);
    expect(parsed.offset).toBe(0);
    expect(parsed.total).toBe(2);
  });

  it("throws when pagination metadata is missing", () => {
    expect(() =>
      parseMembersDirectoryPage({
        entries: [],
        offset: 0,
        total: 0,
      }),
    ).toThrow("Members directory response did not include numeric pagination metadata.");
  });
});
