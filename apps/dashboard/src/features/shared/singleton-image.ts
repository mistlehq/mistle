import { getDashboardConfig } from "../../config.js";
import type { paths } from "../../lib/control-plane-api/generated/schema.js";

export type SingletonImageMetadata =
  paths["/v1/me/profile-image"]["get"]["responses"][200]["content"]["application/json"];

export const ProfileImageContentPath = "/v1/me/profile-image/content";

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
  // Singleton identity surfaces keep a stable control-plane content URL and
  // vary the image version in the query string so callers do not need a fresh
  // signed URL every time the image is rendered.
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
  void organizationId;
  return "/v1/organization/logo/content";
}
