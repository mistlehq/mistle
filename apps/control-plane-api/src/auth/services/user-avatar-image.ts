import { BadRequestError } from "@mistle/http/errors.js";
import sharp from "sharp";

import { ProfileImageRequirements } from "./profile-image-requirements.js";

export type NormalizeUserAvatarImageInput = {
  imageBytes: Uint8Array;
};

export type NormalizedUserAvatarImage = {
  contentType: "image/webp";
  imageBytes: Uint8Array;
  width: number;
  height: number;
};

export async function normalizeUserAvatarImage(
  input: NormalizeUserAvatarImageInput,
): Promise<NormalizedUserAvatarImage> {
  if (input.imageBytes.byteLength === 0) {
    throw new BadRequestError("INVALID_IMAGE", "Avatar upload must not be empty.");
  }

  if (input.imageBytes.byteLength > ProfileImageRequirements.MAX_UPLOAD_BYTES) {
    throw new BadRequestError(
      "INVALID_IMAGE",
      `Avatar upload must be ${String(ProfileImageRequirements.MAX_UPLOAD_BYTES)} bytes or smaller.`,
    );
  }

  const metadata = await readUserAvatarMetadata(input.imageBytes);

  if (metadata.format !== "jpeg" && metadata.format !== "png" && metadata.format !== "webp") {
    throw new BadRequestError(
      "INVALID_IMAGE",
      "Avatar uploads must decode to a JPEG, PNG, or WebP image.",
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

  const outputEdgePixels = Math.min(
    metadata.width,
    metadata.height,
    ProfileImageRequirements.MAX_EDGE_PIXELS,
  );

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
      quality: ProfileImageRequirements.WEBP_QUALITY,
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
