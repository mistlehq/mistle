import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import { NotFoundError } from "@mistle/http/errors.js";

import { requireOrganizationAccess } from "../../auth/services/organization-authorization.js";
import { buildMembershipCapabilities } from "../../auth/services/organization-policy.js";

export type GetMembershipCapabilitiesCtx = {
  db: ControlPlaneDatabase;
};

export type GetMembershipCapabilitiesInput = {
  actorUserId: string;
  activeOrganizationId: string;
  organizationId: string;
};

export async function getMembershipCapabilities(
  ctx: GetMembershipCapabilitiesCtx,
  input: GetMembershipCapabilitiesInput,
): Promise<ReturnType<typeof buildMembershipCapabilities>> {
  const organization = await ctx.db.query.organizations.findFirst({
    columns: {
      id: true,
    },
    where: (organizations, { eq }) => eq(organizations.id, input.organizationId),
  });

  if (organization === undefined) {
    throw new NotFoundError("NOT_FOUND", "Organization was not found.");
  }

  const authorization = await requireOrganizationAccess({
    db: ctx.db,
    actorUserId: input.actorUserId,
    activeOrganizationId: input.activeOrganizationId,
    organizationId: input.organizationId,
  });

  return buildMembershipCapabilities({
    actorRole: authorization.membershipRole,
    organizationId: input.organizationId,
  });
}
