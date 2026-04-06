import { BadRequestError } from "@mistle/http/errors.js";
import sharp from "sharp";

export type NormalizeUserAvatarImageInput = {
  contentType: string;
  imageBytes: Uint8Array;
};

export type NormalizedUserAvatarImage = {
  contentType: "image/webp";
  imageBytes: Uint8Array;
  width: number;
  height: number;
};

const MaxUserAvatarUploadBytes = 5 * 1024 * 1024;
const MaxUserAvatarEdgePixels = 512;
const UserAvatarWebpQuality = 85;

type SupportedUserAvatarContentType = "image/jpeg" | "image/png" | "image/webp";

export async function normalizeUserAvatarImage(
  input: NormalizeUserAvatarImageInput,
): Promise<NormalizedUserAvatarImage> {
  const declaredContentType = parseSupportedUserAvatarContentType(input.contentType);

  if (declaredContentType === null) {
    throw new BadRequestError("INVALID_IMAGE", "Avatar uploads must be JPEG, PNG, or WebP images.");
  }

  if (input.imageBytes.byteLength === 0) {
    throw new BadRequestError("INVALID_IMAGE", "Avatar upload must not be empty.");
  }

  if (input.imageBytes.byteLength > MaxUserAvatarUploadBytes) {
    throw new BadRequestError(
      "INVALID_IMAGE",
      `Avatar upload must be ${String(MaxUserAvatarUploadBytes)} bytes or smaller.`,
    );
  }

  const metadata = await readUserAvatarMetadata(input.imageBytes);
  const detectedContentType = mapDetectedImageFormatToContentType(metadata.format);

  if (detectedContentType === null) {
    throw new BadRequestError(
      "INVALID_IMAGE",
      "Avatar uploads must decode to a JPEG, PNG, or WebP image.",
    );
  }

  if (detectedContentType !== declaredContentType) {
    throw new BadRequestError(
      "INVALID_IMAGE",
      "Avatar upload content type must match the uploaded image bytes.",
    );
  }

  if ((metadata.pages ?? 1) > 1) {
    throw new BadRequestError("INVALID_IMAGE", "Animated avatar uploads are not supported.");
  }

  if (
    metadata.width === undefined ||
    metadata.height === undefined ||
    metadata.width < 1 ||
    metadata.height < 1
  ) {
    throw new BadRequestError(
      "INVALID_IMAGE",
      "Avatar upload must include valid image dimensions.",
    );
  }

  const outputEdgePixels = Math.min(metadata.width, metadata.height, MaxUserAvatarEdgePixels);

  const normalizedImageBuffer = await sharp(input.imageBytes, {
    animated: false,
    failOn: "error",
  })
    .rotate()
    .resize({
      width: outputEdgePixels,
      height: outputEdgePixels,
      fit: "cover",
      position: "centre",
      withoutEnlargement: true,
    })
    .webp({
      quality: UserAvatarWebpQuality,
    })
    .toBuffer();

  return {
    contentType: "image/webp",
    imageBytes: new Uint8Array(normalizedImageBuffer),
    width: outputEdgePixels,
    height: outputEdgePixels,
  };
}

async function readUserAvatarMetadata(imageBytes: Uint8Array) {
  try {
    return await sharp(imageBytes, {
      animated: false,
      failOn: "error",
    }).metadata();
  } catch {
    throw new BadRequestError("INVALID_IMAGE", "Avatar upload must be a valid image.");
  }
}

function parseSupportedUserAvatarContentType(value: string): SupportedUserAvatarContentType | null {
  const [mediaType, ...parameterTokens] = value.split(";");

  if (mediaType === undefined || mediaType.length === 0) {
    return null;
  }

  if (mediaType !== mediaType.trim()) {
    return null;
  }

  if (value.startsWith(";") || parameterTokens.some((token) => token.length === 0)) {
    return null;
  }

  switch (mediaType) {
    case "image/jpeg":
      return "image/jpeg";
    case "image/png":
      return "image/png";
    case "image/webp":
      return "image/webp";
    default:
      return null;
  }
}

function mapDetectedImageFormatToContentType(
  format: string | undefined,
): SupportedUserAvatarContentType | null {
  switch (format) {
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    default:
      return null;
  }
}
