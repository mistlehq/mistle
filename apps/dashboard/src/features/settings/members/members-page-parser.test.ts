import { describe, expect, it } from "vitest";

import { parseMembersPage } from "./members-page-parser.js";

describe("members page parser", () => {
  it("parses member entries and avatar metadata", () => {
    const parsed = parseMembersPage({
      members: [
        {
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
      total: 1,
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
    expect(parsed.memberAvatarsByUserId.get("user_member")).toEqual({
      userId: "user_member",
      hasImage: true,
      imageUrl: "https://example.com/avatar.webp",
    });
    expect(parsed.limit).toBe(25);
    expect(parsed.offset).toBe(0);
    expect(parsed.total).toBe(1);
  });

  it("throws when pagination metadata is missing", () => {
    expect(() =>
      parseMembersPage({
        members: [],
        offset: 0,
        total: 0,
      }),
    ).toThrow("Members page response did not include valid pagination metadata.");
  });
});
