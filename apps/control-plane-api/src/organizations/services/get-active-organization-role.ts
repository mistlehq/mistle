import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import { ForbiddenError, NotFoundError } from "@mistle/http/errors.js";

import {
  parseOrganizationRole,
  type OrganizationRole,
} from "../../auth/services/organization-policy.js";

export async function getActiveOrganizationRole(input: {
  db: ControlPlaneDatabase;
  actorUserId: string;
  activeOrganizationId: string;
  organizationId: string;
}): Promise<OrganizationRole> {
  if (input.organizationId !== input.activeOrganizationId) {
    throw new ForbiddenError("FORBIDDEN", "Forbidden API request.");
  }

  const membership = await input.db.query.members.findFirst({
    columns: {
      role: true,
    },
    where: (members, { and, eq }) =>
      and(eq(members.organizationId, input.organizationId), eq(members.userId, input.actorUserId)),
  });

  if (membership === undefined) {
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

  const actorRole = parseOrganizationRole(membership.role);
  if (actorRole === null) {
    throw new Error("Unexpected organization role was found.");
  }

  return actorRole;
}
