import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import { ForbiddenError, NotFoundError } from "@mistle/http/errors.js";

import {
  getOrganizationPermissions,
  hasOrganizationPermission,
  parseOrganizationRole,
  type OrganizationPermission,
  type OrganizationRole,
} from "./organization-policy.js";

export type OrganizationAuthorizationContext = {
  actorUserId: string;
  activeOrganizationId: string;
  organizationId: string;
  membershipRole: OrganizationRole;
  permissions: readonly OrganizationPermission[];
};

async function requireExistingOrganization(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
}): Promise<void> {
  const organization = await input.db.query.organizations.findFirst({
    columns: {
      id: true,
    },
    where: (organizations, { eq }) => eq(organizations.id, input.organizationId),
  });

  if (organization === undefined) {
    throw new NotFoundError("NOT_FOUND", "Organization was not found.");
  }
}

export async function requireOrganizationAccess(input: {
  db: ControlPlaneDatabase;
  actorUserId: string;
  activeOrganizationId: string;
  organizationId: string;
}): Promise<OrganizationAuthorizationContext> {
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
    await requireExistingOrganization({
      db: input.db,
      organizationId: input.organizationId,
    });

    throw new ForbiddenError("FORBIDDEN", "Forbidden API request.");
  }

  const membershipRole = parseOrganizationRole(membership.role);
  if (membershipRole === null) {
    throw new Error("Unexpected organization role was found.");
  }

  return {
    actorUserId: input.actorUserId,
    activeOrganizationId: input.activeOrganizationId,
    organizationId: input.organizationId,
    membershipRole,
    permissions: getOrganizationPermissions(membershipRole),
  };
}

export async function requireActiveOrganizationAccess(input: {
  db: ControlPlaneDatabase;
  actorUserId: string;
  activeOrganizationId: string;
}): Promise<OrganizationAuthorizationContext> {
  return requireOrganizationAccess({
    ...input,
    organizationId: input.activeOrganizationId,
  });
}

export async function requireOrganizationPermission(input: {
  db: ControlPlaneDatabase;
  actorUserId: string;
  activeOrganizationId: string;
  organizationId: string;
  permission: OrganizationPermission;
}): Promise<OrganizationAuthorizationContext> {
  const authorization = await requireOrganizationAccess(input);

  if (!hasOrganizationPermission(authorization.membershipRole, input.permission)) {
    throw new ForbiddenError("FORBIDDEN", "Forbidden API request.");
  }

  return authorization;
}
