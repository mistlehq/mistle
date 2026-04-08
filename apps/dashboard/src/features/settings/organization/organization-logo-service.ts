import { getDashboardConfig } from "../../../config.js";
import {
  assertSingletonImageHasVersion,
  readSingletonImageMetadataResponse,
  type SingletonImageMetadata,
} from "../../shared/singleton-image.js";
import { executeMembersOperation } from "../members/members-api-errors.js";

function createOrganizationLogoUrl(organizationId: string): URL {
  const config = getDashboardConfig();
  return new URL(
    `/v1/organizations/${encodeURIComponent(organizationId)}/logo`,
    config.controlPlaneApiOrigin,
  );
}

export async function getOrganizationLogo(input: {
  organizationId: string;
}): Promise<SingletonImageMetadata> {
  return executeMembersOperation("getOrganizationLogo", async () => {
    const response = await fetch(createOrganizationLogoUrl(input.organizationId), {
      method: "GET",
      credentials: "include",
      headers: {
        accept: "application/json",
      },
    });

    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => null);
      throw new Error(
        typeof payload === "object" &&
          payload !== null &&
          "message" in payload &&
          typeof payload.message === "string"
          ? payload.message
          : "Could not load organization logo.",
      );
    }

    return readSingletonImageMetadataResponse({
      response,
      resourceName: "Organization logo",
    });
  });
}

export async function uploadOrganizationLogo(input: {
  organizationId: string;
  file: File;
}): Promise<SingletonImageMetadata> {
  return executeMembersOperation("uploadOrganizationLogo", async () => {
    const formData = new FormData();
    formData.set("file", input.file);

    const response = await fetch(createOrganizationLogoUrl(input.organizationId), {
      method: "PUT",
      credentials: "include",
      headers: {
        accept: "application/json",
      },
      body: formData,
    });

    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => null);
      throw new Error(
        typeof payload === "object" &&
          payload !== null &&
          "message" in payload &&
          typeof payload.message === "string"
          ? payload.message
          : "Could not upload organization logo.",
      );
    }

    const result = await readSingletonImageMetadataResponse({
      response,
      resourceName: "Organization logo",
    });
    assertSingletonImageHasVersion({
      image: result,
      resourceName: "Organization logo",
    });

    return result;
  });
}

export async function deleteOrganizationLogo(input: { organizationId: string }): Promise<void> {
  return executeMembersOperation("deleteOrganizationLogo", async () => {
    const response = await fetch(createOrganizationLogoUrl(input.organizationId), {
      method: "DELETE",
      credentials: "include",
      headers: {
        accept: "application/json",
      },
    });

    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => null);
      throw new Error(
        typeof payload === "object" &&
          payload !== null &&
          "message" in payload &&
          typeof payload.message === "string"
          ? payload.message
          : "Could not delete organization logo.",
      );
    }

    await response.text();
  });
}
