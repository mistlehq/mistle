import { describe, expect, it } from "vitest";

import { resolveStoredMediaUrl } from "./resolve-stored-media-url.js";

describe("resolveStoredMediaUrl", () => {
  it("joins the public base URL and object key", () => {
    expect(
      resolveStoredMediaUrl({
        mediaPublicBaseUrl: "https://cdn.mistle.test",
        objectKey: "avatars/users/usr_123/img_456-avatar.webp",
      }),
    ).toBe("https://cdn.mistle.test/avatars/users/usr_123/img_456-avatar.webp");
  });

  it("normalizes leading and trailing slashes", () => {
    expect(
      resolveStoredMediaUrl({
        mediaPublicBaseUrl: "https://cdn.mistle.test/",
        objectKey: "/avatars/users/usr_123/img_456-avatar.webp",
      }),
    ).toBe("https://cdn.mistle.test/avatars/users/usr_123/img_456-avatar.webp");
  });
});
