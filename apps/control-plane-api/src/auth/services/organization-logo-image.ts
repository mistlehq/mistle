import sharp from "sharp";

import { ProfileImageRequirements } from "./profile-image-requirements.js";
import { validateProfileImage } from "./profile-image-validation.js";

export type NormalizeOrganizationLogoImageInput = {
  imageBytes: Uint8Array;
};

export type NormalizedOrganizationLogoImage = {
  contentType: "image/webp";
  imageBytes: Uint8Array;
  width: number;
  height: number;
};

export async function normalizeOrganizationLogoImage(
  input: NormalizeOrganizationLogoImageInput,
): Promise<NormalizedOrganizationLogoImage> {
  const validatedImage = await validateProfileImage({
    imageBytes: input.imageBytes,
    emptyMessage: "Organization logo upload must not be empty.",
    tooLargeMessage: `Organization logo upload must be ${String(ProfileImageRequirements.MAX_UPLOAD_BYTES)} bytes or smaller.`,
    invalidImageMessage: "Organization logo upload must be a valid image.",
    unsupportedFormatMessage:
      "Organization logo uploads must decode to a JPEG, PNG, or WebP image.",
    animatedMessage: "Animated organization logo uploads are not supported.",
    invalidDimensionsMessage: "Organization logo upload must include valid image dimensions.",
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
