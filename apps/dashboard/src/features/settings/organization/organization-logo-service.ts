import { getDashboardConfig } from "../../../config.js";
import {
  assertSingletonImageHasVersion,
  readSingletonImageMetadataResponse,
  throwSingletonImageResponseError,
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
      return throwSingletonImageResponseError({
        fallbackMessage: "Could not load organization logo.",
        response,
      });
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
      return throwSingletonImageResponseError({
        fallbackMessage: "Could not upload organization logo.",
        response,
      });
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
      return throwSingletonImageResponseError({
        fallbackMessage: "Could not delete organization logo.",
        response,
      });
    }

    await response.text();
  });
}
