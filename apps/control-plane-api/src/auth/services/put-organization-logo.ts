import { getControlPlaneDatabaseSchema } from "@mistle/db/control-plane";
import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import { NotFoundError } from "@mistle/http/errors.js";
import type { S3CompatibleObjectStore } from "@mistle/object-store";
import { eq } from "drizzle-orm";
import { typeid } from "typeid-js";

import { deleteObjectBestEffort } from "./delete-object-best-effort.js";
import { normalizeProfileImage } from "./normalize-profile-image.js";

export type PutOrganizationLogoContext = {
  db: ControlPlaneDatabase;
  objectStore: S3CompatibleObjectStore;
};

export type PutOrganizationLogoInput = {
  organizationId: string;
  imageBytes: Uint8Array;
};

export type PutOrganizationLogoResult = {
  organizationId: string;
  logoObjectKey: string;
};

export async function putOrganizationLogo(
  ctx: PutOrganizationLogoContext,
  input: PutOrganizationLogoInput,
): Promise<PutOrganizationLogoResult> {
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

  const normalizedLogo = await normalizeProfileImage({
    imageBytes: input.imageBytes,
  });
  const logoObjectKey = createOrganizationLogoObjectKey(input.organizationId);

  await ctx.objectStore.putObject({
    Body: normalizedLogo.imageBytes,
    ContentType: normalizedLogo.contentType,
    objectKey: logoObjectKey,
  });

  let updatedOrganization:
    | {
        id: string;
        logoObjectKey: string | null;
      }
    | undefined;

  try {
    const updatedOrganizations = await ctx.db
      .update(tables.organizations)
      .set({
        logoObjectKey,
      })
      .where(eq(tables.organizations.id, input.organizationId))
      .returning({
        id: tables.organizations.id,
        logoObjectKey: tables.organizations.logoObjectKey,
      });
    [updatedOrganization] = updatedOrganizations;
  } catch (error) {
    await deleteObjectBestEffort({
      objectStore: ctx.objectStore,
      objectKey: logoObjectKey,
      subject: "organization_logo",
    });
    throw error;
  }

  if (updatedOrganization === undefined || updatedOrganization.logoObjectKey === null) {
    throw new Error("Failed to persist the uploaded organization logo.");
  }

  if (
    existingOrganization.logoObjectKey !== null &&
    existingOrganization.logoObjectKey.length > 0 &&
    existingOrganization.logoObjectKey !== updatedOrganization.logoObjectKey
  ) {
    await deleteObjectBestEffort({
      objectStore: ctx.objectStore,
      objectKey: existingOrganization.logoObjectKey,
      subject: "organization_logo",
    });
  }

  return {
    organizationId: updatedOrganization.id,
    logoObjectKey: updatedOrganization.logoObjectKey,
  };
}

function createOrganizationLogoObjectKey(organizationId: string): string {
  return `logos/organizations/${organizationId}/${typeid("img").toString()}.webp`;
}
