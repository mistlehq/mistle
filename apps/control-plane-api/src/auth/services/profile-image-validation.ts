import { BadRequestError } from "@mistle/http/errors.js";
import sharp from "sharp";

import { ProfileImageRequirements } from "./profile-image-requirements.js";

export type ValidateProfileImageInput = {
  imageBytes: Uint8Array;
};

export type ValidatedProfileImage = {
  width: number;
  height: number;
  outputEdgePixels: number;
};

export async function validateProfileImage(
  input: ValidateProfileImageInput,
): Promise<ValidatedProfileImage> {
  if (input.imageBytes.byteLength === 0) {
    throw new BadRequestError("INVALID_IMAGE", "Image upload must not be empty.");
  }

  if (input.imageBytes.byteLength > ProfileImageRequirements.MAX_UPLOAD_BYTES) {
    throw new BadRequestError(
      "INVALID_IMAGE",
      `Image upload must be ${String(ProfileImageRequirements.MAX_UPLOAD_BYTES)} bytes or smaller.`,
    );
  }

  const metadata = await readProfileImageMetadata(input.imageBytes);

  if (metadata.format !== "jpeg" && metadata.format !== "png" && metadata.format !== "webp") {
    throw new BadRequestError(
      "INVALID_IMAGE",
      "Image uploads must decode to a JPEG, PNG, or WebP image.",
    );
  }

  if ((metadata.pages ?? 1) > 1) {
    throw new BadRequestError("INVALID_IMAGE", "Animated image uploads are not supported.");
  }

  if (
    metadata.width === undefined ||
    metadata.height === undefined ||
    metadata.width < 1 ||
    metadata.height < 1
  ) {
    throw new BadRequestError("INVALID_IMAGE", "Image upload must include valid image dimensions.");
  }

  return {
    width: metadata.width,
    height: metadata.height,
    outputEdgePixels: Math.min(
      metadata.width,
      metadata.height,
      ProfileImageRequirements.MAX_EDGE_PIXELS,
    ),
  };
}

async function readProfileImageMetadata(imageBytes: Uint8Array) {
  try {
    return await sharp(imageBytes, {
      animated: false,
      failOn: "error",
    }).metadata();
  } catch {
    throw new BadRequestError("INVALID_IMAGE", "Image upload must be a valid image.");
  }
}
