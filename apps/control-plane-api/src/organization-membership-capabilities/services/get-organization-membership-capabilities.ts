import type { ControlPlaneDatabase } from "@mistle/db/control-plane";

import {
  buildMembershipCapabilities,
  parseOrganizationRole,
} from "../../auth/services/organization-policy.js";

export type GetOrganizationMembershipCapabilitiesCtx = {
  db: ControlPlaneDatabase;
};

export type GetOrganizationMembershipCapabilitiesInput = {
  actorUserId: string;
  organizationId: string;
};

export type OrganizationMembershipCapabilitiesSuccess = {
  kind: "success";
  data: ReturnType<typeof buildMembershipCapabilities>;
};

export type OrganizationMembershipCapabilitiesResult =
  | OrganizationMembershipCapabilitiesSuccess
  | {
      kind: "forbidden";
    }
  | {
      kind: "not_found";
    };

export async function getOrganizationMembershipCapabilities(
  ctx: GetOrganizationMembershipCapabilitiesCtx,
  input: GetOrganizationMembershipCapabilitiesInput,
): Promise<OrganizationMembershipCapabilitiesResult> {
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
      return {
        kind: "not_found",
      };
    }

    return {
      kind: "forbidden",
    };
  }

  const actorRole = parseOrganizationRole(membership.role);
  if (actorRole === null) {
    throw new Error("Unexpected organization role was found.");
  }

  return {
    kind: "success",
    data: buildMembershipCapabilities({
      actorRole,
      organizationId: input.organizationId,
    }),
  };
}
