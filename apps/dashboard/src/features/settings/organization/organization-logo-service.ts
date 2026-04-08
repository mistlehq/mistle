import { getDashboardConfig } from "../../../config.js";
import {
  parseSingletonImageMetadata,
  type SingletonImageMetadata,
} from "../../shared/singleton-image.js";
import { executeMembersOperation } from "../members/members-api-errors.js";

function createOrganizationLogoUrl(input: { organizationId: string }): URL {
  const config = getDashboardConfig();
  return new URL(
    `/v1/organizations/${encodeURIComponent(input.organizationId)}/logo`,
    config.controlPlaneApiOrigin,
  );
}

export async function getOrganizationLogo(input: {
  organizationId: string;
}): Promise<SingletonImageMetadata> {
  return executeMembersOperation("getOrganizationLogo", async () => {
    const response = await fetch(
      createOrganizationLogoUrl({ organizationId: input.organizationId }),
      {
        method: "GET",
        credentials: "include",
        headers: {
          accept: "application/json",
        },
      },
    );

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

    return parseSingletonImageMetadata({
      payload: await response.json(),
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

    const response = await fetch(
      createOrganizationLogoUrl({ organizationId: input.organizationId }),
      {
        method: "PUT",
        credentials: "include",
        headers: {
          accept: "application/json",
        },
        body: formData,
      },
    );

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

    const result = parseSingletonImageMetadata({
      payload: await response.json(),
      resourceName: "Organization logo",
    });
    if (!result.hasImage || result.imageVersion === null) {
      throw new Error("Organization logo upload response did not include image metadata.");
    }

    return result;
  });
}

export async function deleteOrganizationLogo(input: { organizationId: string }): Promise<void> {
  return executeMembersOperation("deleteOrganizationLogo", async () => {
    const response = await fetch(
      createOrganizationLogoUrl({ organizationId: input.organizationId }),
      {
        method: "DELETE",
        credentials: "include",
        headers: {
          accept: "application/json",
        },
      },
    );

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
