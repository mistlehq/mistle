import { describe, expect, it } from "vitest";

import {
  resolveSignedImageRefetchInterval,
  SIGNED_IMAGE_URL_REFRESH_BUFFER_MS,
} from "./signed-image-query-policy.js";

describe("signed image query policy", () => {
  it("does not refetch when no image URL is available", () => {
    expect(resolveSignedImageRefetchInterval({ expiresAt: null })).toBe(false);
    expect(resolveSignedImageRefetchInterval({ expiresAt: undefined })).toBe(false);
  });

  it("refreshes relative to the explicit expiry time", () => {
    const now = new Date("2026-04-07T00:00:00.000Z");
    const expiresAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString();

    expect(
      resolveSignedImageRefetchInterval({
        expiresAt,
        nowMs: now.getTime(),
      }),
    ).toBe(60 * 60 * 1000 - SIGNED_IMAGE_URL_REFRESH_BUFFER_MS);
  });

  it("does not schedule a negative refresh interval for nearly expired URLs", () => {
    const now = new Date("2026-04-07T00:00:00.000Z");
    const expiresAt = new Date(now.getTime() + 60_000).toISOString();

    expect(
      resolveSignedImageRefetchInterval({
        expiresAt,
        nowMs: now.getTime(),
      }),
    ).toBe(0);
  });
});
