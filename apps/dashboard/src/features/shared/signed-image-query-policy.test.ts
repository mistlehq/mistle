import { describe, expect, it } from "vitest";

import {
  resolveSignedImageRefetchInterval,
  resolveSignedImageStaleTime,
} from "./signed-image-query-policy.js";

describe("signed image query policy", () => {
  it("keeps empty-image states refetchable on focus or reconnect", () => {
    expect(resolveSignedImageRefetchInterval({ refreshAfterSeconds: null })).toBe(false);
    expect(resolveSignedImageRefetchInterval({ refreshAfterSeconds: undefined })).toBe(false);
    expect(resolveSignedImageStaleTime({ refreshAfterSeconds: null })).toBe(0);
    expect(resolveSignedImageStaleTime({ refreshAfterSeconds: undefined })).toBe(0);
  });

  it("refreshes using the server-provided delay", () => {
    expect(resolveSignedImageRefetchInterval({ refreshAfterSeconds: 3300 })).toBe(3_300_000);
    expect(resolveSignedImageStaleTime({ refreshAfterSeconds: 3300 })).toBe(3_300_000);
  });

  it("disables interval polling for nearly expired URLs", () => {
    expect(resolveSignedImageRefetchInterval({ refreshAfterSeconds: 0 })).toBe(false);
    expect(resolveSignedImageStaleTime({ refreshAfterSeconds: 0 })).toBe(0);
  });
});
