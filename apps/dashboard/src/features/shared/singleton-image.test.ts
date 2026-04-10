import { describe, expect, it } from "vitest";

import {
  assertSingletonImageHasVersion,
  createOrganizationLogoContentPath,
  createSingletonImageContentUrl,
  parseSingletonImageMetadata,
  ProfileImageContentPath,
  readSingletonImageMetadataResponse,
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

  it("reads metadata from a response", async () => {
    const response = new Response(
      JSON.stringify({
        hasImage: true,
        imageVersion: "avatars/users/usr_123/img_123.webp",
      }),
    );

    await expect(
      readSingletonImageMetadataResponse({
        resourceName: "Profile image",
        response,
      }),
    ).resolves.toEqual({
      hasImage: true,
      imageVersion: "avatars/users/usr_123/img_123.webp",
    });
  });
});

describe("assertSingletonImageHasVersion", () => {
  it("accepts uploaded image metadata with a version", () => {
    expect(() =>
      assertSingletonImageHasVersion({
        image: {
          hasImage: true,
          imageVersion: "avatars/users/usr_123/img_123.webp",
        },
        resourceName: "Profile image",
      }),
    ).not.toThrow();
  });

  it("fails when uploaded image metadata is incomplete", () => {
    expect(() =>
      assertSingletonImageHasVersion({
        image: {
          hasImage: true,
          imageVersion: null,
        },
        resourceName: "Organization logo",
      }),
    ).toThrow("Organization logo upload response did not include image metadata.");
  });
});

describe("createSingletonImageContentUrl", () => {
  it("returns null when no image exists", () => {
    expect(
      createSingletonImageContentUrl({
        resourceName: "Profile image",
        path: ProfileImageContentPath,
        image: {
          hasImage: false,
          imageVersion: null,
        },
      }),
    ).toBeNull();
  });

  it("builds a stable profile content URL when an image exists", () => {
    expect(
      createSingletonImageContentUrl({
        resourceName: "Profile image",
        path: ProfileImageContentPath,
        image: {
          hasImage: true,
          imageVersion: "avatars/users/usr_123/img_123.webp",
        },
      }),
    ).toBe(
      "http://localhost:3000/v1/me/profile-image/content?v=avatars%2Fusers%2Fusr_123%2Fimg_123.webp",
    );
  });

  it("builds a stable organization logo content URL when an image exists", () => {
    expect(
      createSingletonImageContentUrl({
        resourceName: "Organization logo",
        path: createOrganizationLogoContentPath("org_123"),
        image: {
          hasImage: true,
          imageVersion: "logos/organizations/org_123/img_123.webp",
        },
      }),
    ).toBe(
      "http://localhost:3000/v1/organization/logo/content?v=logos%2Forganizations%2Forg_123%2Fimg_123.webp",
    );
  });
});
