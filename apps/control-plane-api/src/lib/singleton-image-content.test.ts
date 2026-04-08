import { describe, expect, it } from "vitest";

import { requireCurrentSingletonImageObjectKey } from "./singleton-image-content.js";

describe("requireCurrentSingletonImageObjectKey", () => {
  it("returns the object key when the requested version matches", () => {
    expect(
      requireCurrentSingletonImageObjectKey({
        currentObjectKey: "avatars/users/usr_123/img_123.webp",
        notFoundMessage: "Profile image was not found.",
        requestedImageVersion: "avatars/users/usr_123/img_123.webp",
      }),
    ).toBe("avatars/users/usr_123/img_123.webp");
  });

  it("throws when the current object key is missing", () => {
    expect(() =>
      requireCurrentSingletonImageObjectKey({
        currentObjectKey: null,
        notFoundMessage: "Profile image was not found.",
        requestedImageVersion: "avatars/users/usr_123/img_123.webp",
      }),
    ).toThrow("Profile image was not found.");
  });

  it("throws when the requested version is missing", () => {
    expect(() =>
      requireCurrentSingletonImageObjectKey({
        currentObjectKey: "avatars/users/usr_123/img_123.webp",
        notFoundMessage: "Profile image was not found.",
        requestedImageVersion: undefined,
      }),
    ).toThrow("Profile image was not found.");
  });

  it("throws when the requested version is stale", () => {
    expect(() =>
      requireCurrentSingletonImageObjectKey({
        currentObjectKey: "avatars/users/usr_123/img_123.webp",
        notFoundMessage: "Profile image was not found.",
        requestedImageVersion: "avatars/users/usr_123/img_999.webp",
      }),
    ).toThrow("Profile image was not found.");
  });
});
