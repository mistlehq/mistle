import { authClient } from "../../../lib/auth/client.js";
import { parseOrganizationSummary } from "../../organizations/organization-summary-payload.js";
import { executeMembersOperation } from "./members-api-errors.js";
import { parseOrganizationSlugAvailability } from "./members-general-parser.js";

export async function updateProfileDisplayName(input: { displayName: string }): Promise<void> {
  return executeMembersOperation("updateProfileDisplayName", async () => {
    await authClient.$fetch("/update-user", {
      method: "POST",
      throw: true,
      body: {
        name: input.displayName,
      },
    });
  });
}

export async function getOrganizationGeneral(input: {
  organizationId: string;
}): Promise<{ name: string; slug: string }> {
  return executeMembersOperation("getOrganizationGeneral", async () => {
    const result = await authClient.$fetch("/organization/get-full-organization", {
      method: "GET",
      throw: true,
      query: {
        organizationId: input.organizationId,
      },
    });
    return parseOrganizationSummary(result);
  });
}

export async function checkOrganizationSlug(input: { slug: string }): Promise<boolean> {
  return executeMembersOperation("checkOrganizationSlug", async () => {
    const result = await authClient.$fetch("/organization/check-slug", {
      method: "POST",
      throw: true,
      body: {
        slug: input.slug,
      },
    });
    return parseOrganizationSlugAvailability(result);
  });
}

export async function updateOrganizationGeneral(input: {
  organizationId: string;
  name: string;
  slug: string;
}): Promise<void> {
  return executeMembersOperation("updateOrganizationGeneral", async () => {
    await authClient.$fetch("/organization/update", {
      method: "POST",
      throw: true,
      body: {
        organizationId: input.organizationId,
        data: {
          name: input.name,
          slug: input.slug,
        },
      },
    });
  });
}
