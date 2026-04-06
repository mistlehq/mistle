import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { normalizeUserAvatarImage } from "./user-avatar-image.js";

describe("normalizeUserAvatarImage", () => {
  it("converts a wide JPEG into a square WebP avatar without upscaling", async () => {
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

    const normalized = await normalizeUserAvatarImage({
      contentType: "image/jpeg",
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

    const normalized = await normalizeUserAvatarImage({
      contentType: "image/png",
      imageBytes: new Uint8Array(pngBuffer),
    });

    expect(normalized.width).toBe(512);
    expect(normalized.height).toBe(512);
  });

  it("rejects mismatched declared and detected content types", async () => {
    const pngBuffer = await sharp({
      create: {
        width: 128,
        height: 256,
        channels: 4,
        background: {
          r: 20,
          g: 180,
          b: 100,
          alpha: 1,
        },
      },
    })
      .png()
      .toBuffer();

    await expect(
      normalizeUserAvatarImage({
        contentType: "image/jpeg",
        imageBytes: new Uint8Array(pngBuffer),
      }),
    ).rejects.toMatchObject({
      code: "INVALID_IMAGE",
    });
  });

  it("rejects unsupported content types before decoding", async () => {
    const pngBuffer = await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 4,
        background: {
          r: 255,
          g: 255,
          b: 255,
          alpha: 1,
        },
      },
    })
      .png()
      .toBuffer();

    await expect(
      normalizeUserAvatarImage({
        contentType: "image/gif",
        imageBytes: new Uint8Array(pngBuffer),
      }),
    ).rejects.toMatchObject({
      code: "INVALID_IMAGE",
    });
  });
});
