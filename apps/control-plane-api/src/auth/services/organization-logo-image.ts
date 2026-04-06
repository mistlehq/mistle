import { BadRequestError } from "@mistle/http/errors.js";
import sharp from "sharp";

export type NormalizeOrganizationLogoImageInput = {
  imageBytes: Uint8Array;
};

export type NormalizedOrganizationLogoImage = {
  contentType: "image/webp";
  imageBytes: Uint8Array;
  width: number;
  height: number;
};

const MaxOrganizationLogoUploadBytes = 5 * 1024 * 1024;
const MaxOrganizationLogoEdgePixels = 512;
const OrganizationLogoWebpQuality = 85;

export async function normalizeOrganizationLogoImage(
  input: NormalizeOrganizationLogoImageInput,
): Promise<NormalizedOrganizationLogoImage> {
  if (input.imageBytes.byteLength === 0) {
    throw new BadRequestError("INVALID_IMAGE", "Organization logo upload must not be empty.");
  }

  if (input.imageBytes.byteLength > MaxOrganizationLogoUploadBytes) {
    throw new BadRequestError(
      "INVALID_IMAGE",
      `Organization logo upload must be ${String(MaxOrganizationLogoUploadBytes)} bytes or smaller.`,
    );
  }

  const metadata = await readOrganizationLogoMetadata(input.imageBytes);

  if (metadata.format !== "jpeg" && metadata.format !== "png" && metadata.format !== "webp") {
    throw new BadRequestError(
      "INVALID_IMAGE",
      "Organization logo uploads must decode to a JPEG, PNG, or WebP image.",
    );
  }

  if ((metadata.pages ?? 1) > 1) {
    throw new BadRequestError(
      "INVALID_IMAGE",
      "Animated organization logo uploads are not supported.",
    );
  }

  if (
    metadata.width === undefined ||
    metadata.height === undefined ||
    metadata.width < 1 ||
    metadata.height < 1
  ) {
    throw new BadRequestError(
      "INVALID_IMAGE",
      "Organization logo upload must include valid image dimensions.",
    );
  }

  const outputEdgePixels = Math.min(metadata.width, metadata.height, MaxOrganizationLogoEdgePixels);

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
      quality: OrganizationLogoWebpQuality,
    })
    .toBuffer();

  return {
    contentType: "image/webp",
    imageBytes: new Uint8Array(normalizedImageBuffer),
    width: outputEdgePixels,
    height: outputEdgePixels,
  };
}

async function readOrganizationLogoMetadata(imageBytes: Uint8Array) {
  try {
    return await sharp(imageBytes, {
      animated: false,
      failOn: "error",
    }).metadata();
  } catch {
    throw new BadRequestError("INVALID_IMAGE", "Organization logo upload must be a valid image.");
  }
}
