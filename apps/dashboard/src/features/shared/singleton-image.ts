import { getDashboardConfig } from "../../config.js";

export type SingletonImageMetadata = {
  hasImage: boolean;
  imageVersion: string | null;
};

export function parseSingletonImageMetadata(input: {
  payload: unknown;
  resourceName: string;
}): SingletonImageMetadata {
  const { payload, resourceName } = input;

  if (typeof payload !== "object" || payload === null) {
    throw new Error(`${resourceName} response was invalid.`);
  }

  if (!("hasImage" in payload) || typeof payload.hasImage !== "boolean") {
    throw new Error(`${resourceName} response was missing hasImage.`);
  }

  if (
    !("imageVersion" in payload) ||
    (payload.imageVersion !== null && typeof payload.imageVersion !== "string")
  ) {
    throw new Error(`${resourceName} response imageVersion was invalid.`);
  }

  return {
    hasImage: payload.hasImage,
    imageVersion: payload.imageVersion,
  };
}

export function createSingletonImageContentUrl(input: {
  pathname: string;
  image: SingletonImageMetadata | null | undefined;
  missingVersionMessage: string;
}): string | null {
  if (input.image === undefined || input.image === null || !input.image.hasImage) {
    return null;
  }

  if (input.image.imageVersion === null) {
    throw new Error(input.missingVersionMessage);
  }

  const config = getDashboardConfig();
  const url = new URL(input.pathname, config.controlPlaneApiOrigin);
  url.searchParams.set("v", input.image.imageVersion);
  return url.toString();
}
