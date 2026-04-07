import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { normalizeProfileImage } from "./normalize-profile-image.js";

describe("normalizeProfileImage", () => {
  it("converts a wide JPEG into a square WebP image without upscaling", async () => {
    const jpegBuffer = await sharp({
      create: {
        width: 900,
        height: 300,
        channels: 3,
        background: {
          r: 32,
          g: 128,
          b: 224,
        },
      },
    })
      .jpeg()
      .toBuffer();

    const normalized = await normalizeProfileImage({
      imageBytes: new Uint8Array(jpegBuffer),
    });

    expect(normalized.contentType).toBe("image/webp");
    expect(normalized.width).toBe(300);
    expect(normalized.height).toBe(300);

    const metadata = await sharp(normalized.imageBytes).metadata();

    expect(metadata.format).toBe("webp");
    expect(metadata.width).toBe(300);
    expect(metadata.height).toBe(300);
  });

  it("caps output size at 512 pixels per edge", async () => {
    const pngBuffer = await sharp({
      create: {
        width: 1400,
        height: 1200,
        channels: 4,
        background: {
          r: 200,
          g: 120,
          b: 20,
          alpha: 1,
        },
      },
    })
      .png()
      .toBuffer();

    const normalized = await normalizeProfileImage({
      imageBytes: new Uint8Array(pngBuffer),
    });

    expect(normalized.width).toBe(512);
    expect(normalized.height).toBe(512);
  });

  it("rejects unsupported image bytes", async () => {
    await expect(
      normalizeProfileImage({
        imageBytes: new TextEncoder().encode("not-an-image"),
      }),
    ).rejects.toMatchObject({
      code: "INVALID_IMAGE",
    });
  });
});
