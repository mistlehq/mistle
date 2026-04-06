import sharp from "sharp";

export type TestImageFormat = "jpeg" | "png" | "webp";

export async function createTestImageBuffer(input: {
  width: number;
  height: number;
  channels: 3 | 4;
  background:
    | {
        r: number;
        g: number;
        b: number;
      }
    | {
        r: number;
        g: number;
        b: number;
        alpha: number;
      };
  format: TestImageFormat;
}): Promise<Buffer> {
  const image = sharp({
    create: {
      width: input.width,
      height: input.height,
      channels: input.channels,
      background: input.background,
    },
  });

  if (input.format === "jpeg") {
    return image.jpeg().toBuffer();
  }

  if (input.format === "png") {
    return image.png().toBuffer();
  }

  return image.webp().toBuffer();
}
