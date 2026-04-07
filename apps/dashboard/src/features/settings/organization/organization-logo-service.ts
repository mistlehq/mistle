import { getDashboardConfig } from "../../../config.js";
import { executeMembersOperation } from "../members/members-api-errors.js";

function parseOrganizationLogoPayload(payload: unknown): { imageUrl: string | null } {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Organization logo response was invalid.");
  }

  if (!("imageUrl" in payload)) {
    throw new Error("Organization logo response was missing imageUrl.");
  }

  if (payload.imageUrl !== null && typeof payload.imageUrl !== "string") {
    throw new Error("Organization logo response imageUrl was invalid.");
  }

  return {
    imageUrl: payload.imageUrl,
  };
}

function createOrganizationLogoUrl(input: { organizationId: string }): URL {
  const config = getDashboardConfig();
  return new URL(
    `/v1/organizations/${encodeURIComponent(input.organizationId)}/logo`,
    config.controlPlaneApiOrigin,
  );
}

export async function getOrganizationLogo(input: {
  organizationId: string;
}): Promise<{ imageUrl: string | null }> {
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

    return parseOrganizationLogoPayload(await response.json());
  });
}

export async function uploadOrganizationLogo(input: {
  organizationId: string;
  file: File;
}): Promise<{ imageUrl: string }> {
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

    const result = parseOrganizationLogoPayload(await response.json());
    if (result.imageUrl === null) {
      throw new Error("Organization logo upload response did not include imageUrl.");
    }

    return {
      imageUrl: result.imageUrl,
    };
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
