import { getControlPlaneDatabaseSchema } from "@mistle/db/control-plane";
import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import { NotFoundError } from "@mistle/http/errors.js";
import type { S3CompatibleObjectStore } from "@mistle/object-store";
import { eq } from "drizzle-orm";

import { deleteObjectBestEffort } from "./delete-object-best-effort.js";

export type DeleteOrganizationLogoContext = {
  db: ControlPlaneDatabase;
  objectStore: S3CompatibleObjectStore;
};

export type DeleteOrganizationLogoInput = {
  organizationId: string;
};

export async function deleteOrganizationLogo(
  ctx: DeleteOrganizationLogoContext,
  input: DeleteOrganizationLogoInput,
): Promise<void> {
  const tables = getControlPlaneDatabaseSchema(ctx.db);

  const existingOrganization = await ctx.db.query.organizations.findFirst({
    columns: {
      id: true,
      logoObjectKey: true,
    },
    where: (table, { eq: equals }) => equals(table.id, input.organizationId),
  });

  if (existingOrganization === undefined) {
    throw new NotFoundError("NOT_FOUND", "Organization was not found.");
  }

  if (
    existingOrganization.logoObjectKey === null ||
    existingOrganization.logoObjectKey.length === 0
  ) {
    return;
  }

  const updatedOrganizations = await ctx.db
    .update(tables.organizations)
    .set({
      logoObjectKey: null,
    })
    .where(eq(tables.organizations.id, input.organizationId))
    .returning({
      id: tables.organizations.id,
    });
  const [updatedOrganization] = updatedOrganizations;

  if (updatedOrganization === undefined) {
    throw new Error("Failed to remove the uploaded organization logo.");
  }

  await deleteObjectBestEffort({
    objectStore: ctx.objectStore,
    objectKey: existingOrganization.logoObjectKey,
    subject: "organization_logo",
  });
}
