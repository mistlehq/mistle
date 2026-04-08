import { getDashboardConfig } from "../../config.js";

export type SingletonImageMetadata = {
  hasImage: boolean;
  imageVersion: string | null;
};

export const ProfileImageContentPath = "/v1/me/profile-image/content";

function resolveSingletonImageResponseErrorMessage(input: {
  fallbackMessage: string;
  payload: unknown;
}): string {
  if (
    typeof input.payload === "object" &&
    input.payload !== null &&
    "message" in input.payload &&
    typeof input.payload.message === "string"
  ) {
    return input.payload.message;
  }

  return input.fallbackMessage;
}

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

export async function readSingletonImageMetadataResponse(input: {
  resourceName: string;
  response: Response;
}): Promise<SingletonImageMetadata> {
  return parseSingletonImageMetadata({
    payload: await input.response.json(),
    resourceName: input.resourceName,
  });
}

export async function throwSingletonImageResponseError(input: {
  fallbackMessage: string;
  response: Response;
}): Promise<never> {
  const payload: unknown = await input.response.json().catch(() => null);
  throw new Error(
    resolveSingletonImageResponseErrorMessage({
      fallbackMessage: input.fallbackMessage,
      payload,
    }),
  );
}

export function assertSingletonImageHasVersion(input: {
  image: SingletonImageMetadata;
  resourceName: string;
}): void {
  if (!input.image.hasImage || input.image.imageVersion === null) {
    throw new Error(`${input.resourceName} upload response did not include image metadata.`);
  }
}

export function createSingletonImageContentUrl(input: {
  resourceName: string;
  path: string;
  image: SingletonImageMetadata | null | undefined;
}): string | null {
  if (input.image === undefined || input.image === null || !input.image.hasImage) {
    return null;
  }

  if (input.image.imageVersion === null) {
    throw new Error(`${input.resourceName} metadata was missing imageVersion.`);
  }

  const config = getDashboardConfig();
  const url = new URL(input.path, config.controlPlaneApiOrigin);
  url.searchParams.set("v", input.image.imageVersion);
  return url.toString();
}

export function createOrganizationLogoContentPath(organizationId: string): string {
  return `/v1/organizations/${encodeURIComponent(organizationId)}/logo/content`;
}
