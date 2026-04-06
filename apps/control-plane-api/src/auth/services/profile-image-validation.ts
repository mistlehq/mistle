import { BadRequestError } from "@mistle/http/errors.js";
import sharp from "sharp";

import { ProfileImageRequirements } from "./profile-image-requirements.js";

export type ValidateProfileImageInput = {
  imageBytes: Uint8Array;
  emptyMessage: string;
  tooLargeMessage: string;
  invalidImageMessage: string;
  unsupportedFormatMessage: string;
  animatedMessage: string;
  invalidDimensionsMessage: string;
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
    throw new BadRequestError("INVALID_IMAGE", input.emptyMessage);
  }

  if (input.imageBytes.byteLength > ProfileImageRequirements.MAX_UPLOAD_BYTES) {
    throw new BadRequestError("INVALID_IMAGE", input.tooLargeMessage);
  }

  const metadata = await readProfileImageMetadata({
    imageBytes: input.imageBytes,
    invalidImageMessage: input.invalidImageMessage,
  });

  if (metadata.format !== "jpeg" && metadata.format !== "png" && metadata.format !== "webp") {
    throw new BadRequestError("INVALID_IMAGE", input.unsupportedFormatMessage);
  }

  if ((metadata.pages ?? 1) > 1) {
    throw new BadRequestError("INVALID_IMAGE", input.animatedMessage);
  }

  if (
    metadata.width === undefined ||
    metadata.height === undefined ||
    metadata.width < 1 ||
    metadata.height < 1
  ) {
    throw new BadRequestError("INVALID_IMAGE", input.invalidDimensionsMessage);
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

async function readProfileImageMetadata(input: {
  imageBytes: Uint8Array;
  invalidImageMessage: string;
}) {
  try {
    return await sharp(input.imageBytes, {
      animated: false,
      failOn: "error",
    }).metadata();
  } catch {
    throw new BadRequestError("INVALID_IMAGE", input.invalidImageMessage);
  }
}
