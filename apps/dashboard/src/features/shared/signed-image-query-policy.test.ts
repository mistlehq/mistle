import { describe, expect, it } from "vitest";

import { resolveSignedImageRefetchInterval } from "./signed-image-query-policy.js";

describe("signed image query policy", () => {
  it("does not refetch when no image URL is available", () => {
    expect(resolveSignedImageRefetchInterval({ refreshAfterSeconds: null })).toBe(false);
    expect(resolveSignedImageRefetchInterval({ refreshAfterSeconds: undefined })).toBe(false);
  });

  it("refreshes using the server-provided delay", () => {
    expect(resolveSignedImageRefetchInterval({ refreshAfterSeconds: 3300 })).toBe(3_300_000);
  });

  it("disables interval polling for nearly expired URLs", () => {
    expect(resolveSignedImageRefetchInterval({ refreshAfterSeconds: 0 })).toBe(false);
  });
});
