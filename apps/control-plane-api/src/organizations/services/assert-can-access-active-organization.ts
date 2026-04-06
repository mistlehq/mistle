import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import { ForbiddenError, NotFoundError } from "@mistle/http/errors.js";

export async function assertCanAccessActiveOrganization(input: {
  db: ControlPlaneDatabase;
  actorUserId: string;
  activeOrganizationId: string;
  organizationId: string;
}): Promise<void> {
  if (input.organizationId !== input.activeOrganizationId) {
    throw new ForbiddenError("FORBIDDEN", "Forbidden API request.");
  }

  const membership = await input.db.query.members.findFirst({
    columns: {
      organizationId: true,
    },
    where: (members, { and, eq }) =>
      and(eq(members.organizationId, input.organizationId), eq(members.userId, input.actorUserId)),
  });

  if (membership !== undefined) {
    return;
  }

  const organization = await input.db.query.organizations.findFirst({
    columns: {
      id: true,
    },
    where: (organizations, { eq }) => eq(organizations.id, input.organizationId),
  });

  if (organization === undefined) {
    throw new NotFoundError("NOT_FOUND", "Organization was not found.");
  }

  throw new ForbiddenError("FORBIDDEN", "Forbidden API request.");
}
