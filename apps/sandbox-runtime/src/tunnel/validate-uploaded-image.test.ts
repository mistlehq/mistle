import { describe, expect, it } from "vitest";

import { detectSupportedImageMimeType, ImageSignatures } from "./validate-uploaded-image.js";

describe("detectSupportedImageMimeType", () => {
  it("detects PNG signatures", () => {
    expect(detectSupportedImageMimeType(ImageSignatures.PNG)).toBe("image/png");
  });

  it("detects JPEG signatures", () => {
    expect(detectSupportedImageMimeType(new Uint8Array([...ImageSignatures.JPEG, 0xdb]))).toBe(
      "image/jpeg",
    );
  });

  it("detects GIF signatures", () => {
    expect(detectSupportedImageMimeType(ImageSignatures.GIF89A)).toBe("image/gif");
  });

  it("detects WebP signatures", () => {
    expect(
      detectSupportedImageMimeType(
        new Uint8Array([
          ...ImageSignatures.WEBP_RIFF,
          0x24,
          0x00,
          0x00,
          0x00,
          ...ImageSignatures.WEBP_BRAND,
        ]),
      ),
    ).toBe("image/webp");
  });

  it("returns null for unknown signatures", () => {
    expect(detectSupportedImageMimeType(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });
});
