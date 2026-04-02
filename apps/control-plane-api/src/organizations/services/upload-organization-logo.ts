import { organizations, type ControlPlaneDatabase } from "@mistle/db/control-plane";
import { ForbiddenError, NotFoundError } from "@mistle/http/errors.js";
import { S3CompatibleObjectStore } from "@mistle/object-store";
import { eq } from "drizzle-orm";

import { parseOrganizationRole } from "../../auth/services/organization-policy.js";
import { deleteObjectIgnoringErrors } from "../../media/services/delete-object-ignoring-errors.js";
import { normalizeUploadedImage } from "../../media/services/normalize-uploaded-image.js";
import { createOrganizationLogoObjectKey } from "../../media/services/object-key.js";

export type UploadOrganizationLogoInput = {
  actorUserId: string;
  organizationId: string;
  body: Uint8Array;
  contentType: string;
};

export async function uploadOrganizationLogo(
  ctx: {
    db: ControlPlaneDatabase;
    objectStore: S3CompatibleObjectStore;
  },
  input: UploadOrganizationLogoInput,
): Promise<string> {
  const membership = await ctx.db.query.members.findFirst({
    columns: {
      role: true,
    },
    where: (table, { and: andWhere, eq: equals }) =>
      andWhere(
        equals(table.organizationId, input.organizationId),
        equals(table.userId, input.actorUserId),
      ),
  });

  if (membership === undefined) {
    const organization = await ctx.db.query.organizations.findFirst({
      columns: {
        id: true,
      },
      where: (table, { eq: equals }) => equals(table.id, input.organizationId),
    });

    if (organization === undefined) {
      throw new NotFoundError("NOT_FOUND", "Organization was not found.");
    }

    throw new ForbiddenError("FORBIDDEN", "Forbidden API request.");
  }

  const actorRole = parseOrganizationRole(membership.role);
  if (actorRole !== "owner" && actorRole !== "admin") {
    throw new ForbiddenError("FORBIDDEN", "Forbidden API request.");
  }

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

  const normalizedImage = await normalizeUploadedImage({
    body: input.body,
    contentType: input.contentType,
  });
  const logoObjectKey = createOrganizationLogoObjectKey(existingOrganization.id);

  await ctx.objectStore.putObject({
    objectKey: logoObjectKey,
    Body: normalizedImage.body,
    ContentType: normalizedImage.contentType,
  });

  try {
    await ctx.db
      .update(organizations)
      .set({
        logoObjectKey,
      })
      .where(eq(organizations.id, existingOrganization.id));
  } catch (error) {
    await deleteObjectIgnoringErrors(ctx.objectStore, logoObjectKey);
    throw error;
  }

  if (existingOrganization.logoObjectKey !== null) {
    await deleteObjectIgnoringErrors(ctx.objectStore, existingOrganization.logoObjectKey);
  }

  return logoObjectKey;
}
