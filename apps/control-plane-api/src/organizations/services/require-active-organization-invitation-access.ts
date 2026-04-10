import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import { ForbiddenError } from "@mistle/http/errors.js";

import { buildMembershipCapabilities } from "../../auth/services/organization-policy.js";
import { getActiveOrganizationRole } from "./get-active-organization-role.js";

export async function requireActiveOrganizationInvitationAccess(input: {
  db: ControlPlaneDatabase;
  actorUserId: string;
  activeOrganizationId: string;
  organizationId: string;
}): Promise<void> {
  const actorRole = await getActiveOrganizationRole({
    db: input.db,
    actorUserId: input.actorUserId,
    activeOrganizationId: input.activeOrganizationId,
    organizationId: input.organizationId,
  });
  const capabilities = buildMembershipCapabilities({
    actorRole,
    organizationId: input.organizationId,
  });
  if (!capabilities.invite.canExecute) {
    throw new ForbiddenError("FORBIDDEN", "Forbidden API request.");
  }
}
