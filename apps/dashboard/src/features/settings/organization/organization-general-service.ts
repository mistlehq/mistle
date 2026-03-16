import { z } from "zod";

import { authClient } from "../../../lib/auth/client.js";
import { executeMembersOperation } from "../members/members-api-errors.js";

const OrganizationGeneralSchema = z.object({
  name: z.string(),
  slug: z.string(),
});

function parseOrganizationGeneral(value: unknown): { name: string; slug: string } {
  const parsedOrganization = OrganizationGeneralSchema.safeParse(value);
  if (!parsedOrganization.success) {
    throw new Error("Organization fields were missing.");
  }

  return {
    name: parsedOrganization.data.name,
    slug: parsedOrganization.data.slug,
  };
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
    return parseOrganizationGeneral(result);
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
