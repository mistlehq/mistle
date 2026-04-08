import sharp from "sharp";

import { ProfileImageRequirements } from "./profile-image-requirements.js";
import { validateProfileImage } from "./profile-image-validation.js";

export type NormalizeProfileImageInput = {
  imageBytes: Uint8Array;
};

export type NormalizedProfileImage = {
  contentType: "image/webp";
  imageBytes: Uint8Array;
  width: number;
  height: number;
};

export async function normalizeProfileImage(
  input: NormalizeProfileImageInput,
): Promise<NormalizedProfileImage> {
  const validatedImage = await validateProfileImage({
    imageBytes: input.imageBytes,
  });

  const normalizedImageBuffer = await sharp(input.imageBytes, {
    animated: false,
    failOn: "error",
  })
    .rotate()
    .resize({
      width: validatedImage.outputEdgePixels,
      height: validatedImage.outputEdgePixels,
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
    width: validatedImage.outputEdgePixels,
    height: validatedImage.outputEdgePixels,
  };
}
