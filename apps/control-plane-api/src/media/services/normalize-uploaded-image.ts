import { BadRequestError } from "@mistle/http/errors.js";
import sharp from "sharp";

const SupportedContentTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const SupportedImageFormats = new Set(["jpeg", "png", "webp"]);

const MaxUploadedImageBytes = 5 * 1024 * 1024;
const MinUploadedImageDimension = 128;
const MaxNormalizedImageDimension = 512;
const NormalizedImageContentType = "image/webp";

export type NormalizeUploadedImageInput = {
  body: Uint8Array;
  contentType: string;
};

export type NormalizedUploadedImage = {
  body: Uint8Array;
  contentType: typeof NormalizedImageContentType;
};

export async function normalizeUploadedImage(
  input: NormalizeUploadedImageInput,
): Promise<NormalizedUploadedImage> {
  if (!SupportedContentTypes.has(input.contentType)) {
    throw new BadRequestError(
      "INVALID_IMAGE_CONTENT_TYPE",
      "Uploaded image must be a PNG, JPEG, or WebP file.",
    );
  }

  if (input.body.byteLength > MaxUploadedImageBytes) {
    throw new BadRequestError("IMAGE_TOO_LARGE", "Uploaded image must be 5 MB or smaller.");
  }

  const metadata = await sharp(input.body).metadata();
  const format = metadata.format;
  if (format === undefined || !SupportedImageFormats.has(format)) {
    throw new BadRequestError(
      "INVALID_IMAGE_FORMAT",
      "Uploaded image bytes must decode to a PNG, JPEG, or WebP file.",
    );
  }

  const width = metadata.width;
  const height = metadata.height;
  if (
    width === undefined ||
    height === undefined ||
    width < MinUploadedImageDimension ||
    height < MinUploadedImageDimension
  ) {
    throw new BadRequestError("IMAGE_TOO_SMALL", "Uploaded image must be at least 128x128 pixels.");
  }

  const normalizedDimension = Math.min(width, height, MaxNormalizedImageDimension);
  const normalizedBody = await sharp(input.body)
    .rotate()
    .resize({
      width: normalizedDimension,
      height: normalizedDimension,
      fit: "cover",
      position: "centre",
    })
    .webp()
    .toBuffer();

  return {
    body: Uint8Array.from(normalizedBody),
    contentType: NormalizedImageContentType,
  };
}
