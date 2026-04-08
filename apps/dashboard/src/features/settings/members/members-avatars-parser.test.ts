import { describe, expect, it } from "vitest";

import { parseMemberAvatars } from "./members-avatars-parser.js";

describe("members avatars parser", () => {
  it("parses valid avatar payloads", () => {
    const parsed = parseMemberAvatars([
      {
        userId: "user_123",
        hasImage: true,
        imageUrl: "https://example.com/avatar.png",
      },
      {
        userId: "user_456",
        hasImage: false,
        imageUrl: null,
      },
    ]);

    expect(parsed).toEqual([
      {
        userId: "user_123",
        hasImage: true,
        imageUrl: "https://example.com/avatar.png",
      },
      {
        userId: "user_456",
        hasImage: false,
        imageUrl: null,
      },
    ]);
  });

  it("returns null when the payload is not an array", () => {
    expect(parseMemberAvatars({})).toBeNull();
  });

  it("returns null when a required field is missing", () => {
    expect(
      parseMemberAvatars([
        {
          userId: "user_123",
          imageUrl: "https://example.com/avatar.png",
        },
      ]),
    ).toBeNull();
  });

  it("returns null when imageUrl is neither a string nor null", () => {
    expect(
      parseMemberAvatars([
        {
          userId: "user_123",
          hasImage: true,
          imageUrl: 123,
        },
      ]),
    ).toBeNull();
  });
});
