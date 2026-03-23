import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import { ForbiddenError, NotFoundError } from "@mistle/http/errors.js";

import {
  buildMembershipCapabilities,
  parseOrganizationRole,
} from "../../auth/services/organization-policy.js";

export type GetMembershipCapabilitiesCtx = {
  db: ControlPlaneDatabase;
};

export type GetMembershipCapabilitiesInput = {
  actorUserId: string;
  organizationId: string;
};

export async function getMembershipCapabilities(
  ctx: GetMembershipCapabilitiesCtx,
  input: GetMembershipCapabilitiesInput,
): Promise<ReturnType<typeof buildMembershipCapabilities>> {
  const membership = await ctx.db.query.members.findFirst({
    columns: {
      role: true,
    },
    where: (members, { and, eq }) =>
      and(eq(members.organizationId, input.organizationId), eq(members.userId, input.actorUserId)),
  });

  if (membership === undefined) {
    const organization = await ctx.db.query.organizations.findFirst({
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

  return buildMembershipCapabilities({
    actorRole,
    organizationId: input.organizationId,
  });
}
