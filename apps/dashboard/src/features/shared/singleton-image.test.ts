import { describe, expect, it } from "vitest";

import {
  createOrganizationLogoContentPath,
  createSingletonImageContentUrl,
  createSingletonImageMissingVersionMessage,
  parseSingletonImageMetadata,
  ProfileImageContentPath,
} from "./singleton-image.js";

describe("parseSingletonImageMetadata", () => {
  it("parses singleton image metadata payloads", () => {
    expect(
      parseSingletonImageMetadata({
        payload: {
          hasImage: true,
          imageVersion: "avatars/users/usr_123/img_123.webp",
        },
        resourceName: "Profile image",
      }),
    ).toEqual({
      hasImage: true,
      imageVersion: "avatars/users/usr_123/img_123.webp",
    });
  });

  it("fails when hasImage is missing", () => {
    expect(() =>
      parseSingletonImageMetadata({
        payload: {
          imageVersion: null,
        },
        resourceName: "Organization logo",
      }),
    ).toThrow("Organization logo response was missing hasImage.");
  });
});

describe("createSingletonImageContentUrl", () => {
  it("returns null when no image exists", () => {
    expect(
      createSingletonImageContentUrl({
        path: ProfileImageContentPath,
        image: {
          hasImage: false,
          imageVersion: null,
        },
        missingVersionMessage: createSingletonImageMissingVersionMessage("Profile image"),
      }),
    ).toBeNull();
  });

  it("builds a stable profile content URL when an image exists", () => {
    expect(
      createSingletonImageContentUrl({
        path: ProfileImageContentPath,
        image: {
          hasImage: true,
          imageVersion: "avatars/users/usr_123/img_123.webp",
        },
        missingVersionMessage: createSingletonImageMissingVersionMessage("Profile image"),
      }),
    ).toBe(
      "http://localhost:3000/v1/me/profile-image/content?v=avatars%2Fusers%2Fusr_123%2Fimg_123.webp",
    );
  });

  it("builds a stable organization logo content URL when an image exists", () => {
    expect(
      createSingletonImageContentUrl({
        path: createOrganizationLogoContentPath("org_123"),
        image: {
          hasImage: true,
          imageVersion: "logos/organizations/org_123/img_123.webp",
        },
        missingVersionMessage: createSingletonImageMissingVersionMessage("Organization logo"),
      }),
    ).toBe(
      "http://localhost:3000/v1/organizations/org_123/logo/content?v=logos%2Forganizations%2Forg_123%2Fimg_123.webp",
    );
  });
});
