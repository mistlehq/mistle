import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import { NotFoundError } from "@mistle/http/errors.js";

export async function getOrganizationLogo(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
}): Promise<{ logoObjectKey: string | null }> {
  const organization = await input.db.query.organizations.findFirst({
    columns: {
      logoObjectKey: true,
    },
    where: (table, { eq }) => eq(table.id, input.organizationId),
  });

  if (organization === undefined) {
    throw new NotFoundError("NOT_FOUND", "Organization was not found.");
  }

  return {
    logoObjectKey:
      organization.logoObjectKey !== null && organization.logoObjectKey.length > 0
        ? organization.logoObjectKey
        : null,
  };
}
