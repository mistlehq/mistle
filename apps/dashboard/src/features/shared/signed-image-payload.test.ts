import { describe, expect, it } from "vitest";

import { parseSignedImagePayload } from "./signed-image-payload.js";

describe("parseSignedImagePayload", () => {
  it("uses the server-provided refresh delay when present", () => {
    expect(
      parseSignedImagePayload({
        payload: { imageUrl: "https://example.com/image.png", refreshAfterSeconds: 3300 },
        responseName: "Profile image response",
      }),
    ).toEqual({
      imageUrl: "https://example.com/image.png",
      refreshAfterSeconds: 3300,
    });
  });

  it("uses the explicit legacy refresh delay for older non-null payloads", () => {
    expect(
      parseSignedImagePayload({
        payload: { imageUrl: "https://example.com/image.png" },
        responseName: "Profile image response",
      }),
    ).toEqual({
      imageUrl: "https://example.com/image.png",
      refreshAfterSeconds: 3300,
    });
  });

  it("keeps empty-image states unscheduled", () => {
    expect(
      parseSignedImagePayload({
        payload: { imageUrl: null },
        responseName: "Organization logo response",
      }),
    ).toEqual({
      imageUrl: null,
      refreshAfterSeconds: null,
    });
  });

  it("rejects invalid refresh delays", () => {
    expect(() =>
      parseSignedImagePayload({
        payload: { imageUrl: "https://example.com/image.png", refreshAfterSeconds: -1 },
        responseName: "Profile image response",
      }),
    ).toThrow("Profile image response refreshAfterSeconds was invalid.");
  });
});
