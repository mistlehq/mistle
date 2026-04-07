import { describe, expect, it } from "vitest";

import {
  resolveSignedImageRefetchInterval,
  SIGNED_IMAGE_URL_REFRESH_INTERVAL_MS,
  SIGNED_IMAGE_URL_REFRESH_BUFFER_MS,
  SIGNED_IMAGE_URL_TTL_MS,
} from "./signed-image-query-policy.js";

describe("signed image query policy", () => {
  it("does not refetch when no image URL is available", () => {
    expect(resolveSignedImageRefetchInterval({ imageUrl: null })).toBe(false);
    expect(resolveSignedImageRefetchInterval({ imageUrl: undefined })).toBe(false);
  });

  it("refreshes before the presigned URL TTL expires", () => {
    expect(
      resolveSignedImageRefetchInterval({ imageUrl: "https://images.example.com/file.webp" }),
    ).toBe(SIGNED_IMAGE_URL_REFRESH_INTERVAL_MS);
    expect(SIGNED_IMAGE_URL_REFRESH_INTERVAL_MS).toBe(
      SIGNED_IMAGE_URL_TTL_MS - SIGNED_IMAGE_URL_REFRESH_BUFFER_MS,
    );
  });
});
