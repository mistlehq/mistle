import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import { ForbiddenError } from "@mistle/http/errors.js";

import { parseOrganizationRole } from "../../auth/services/organization-policy.js";
import { assertCanAccessActiveOrganization } from "./assert-can-access-active-organization.js";

export async function assertCanManageActiveOrganization(input: {
  db: ControlPlaneDatabase;
  actorUserId: string;
  activeOrganizationId: string;
  organizationId: string;
}): Promise<void> {
  await assertCanAccessActiveOrganization(input);

  const membership = await input.db.query.members.findFirst({
    columns: {
      role: true,
    },
    where: (members, { and, eq }) =>
      and(eq(members.organizationId, input.organizationId), eq(members.userId, input.actorUserId)),
  });

  if (membership === undefined) {
    throw new Error("Expected organization membership to exist after access check.");
  }

  const actorRole = parseOrganizationRole(membership.role);
  if (actorRole === null) {
    throw new Error("Unexpected organization role was found.");
  }

  if (actorRole !== "owner" && actorRole !== "admin") {
    throw new ForbiddenError("FORBIDDEN", "Forbidden API request.");
  }
}
