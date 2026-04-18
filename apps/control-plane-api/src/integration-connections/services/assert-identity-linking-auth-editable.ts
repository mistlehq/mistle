import {
  OrganizationIdentityLinkProviderConfigStatus,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import { ConflictError } from "@mistle/http/errors.js";

import { IntegrationConnectionsConflictCodes } from "../constants.js";

export async function assertIdentityLinkingAuthEditableOrThrow(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
  connectionId: string;
}): Promise<void> {
  const activeIdentityLinkProviderConfig =
    await input.db.query.organizationIdentityLinkProviderConfigs.findFirst({
      columns: {
        providerFamily: true,
      },
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, input.organizationId),
          eq(table.integrationConnectionId, input.connectionId),
          eq(table.status, OrganizationIdentityLinkProviderConfigStatus.ACTIVE),
        ),
    });

  if (activeIdentityLinkProviderConfig === undefined) {
    return;
  }

  throw new ConflictError(
    IntegrationConnectionsConflictCodes.CONNECTION_USED_BY_IDENTITY_LINKING,
    "This integration connection cannot be edited while it is configured for Identity Linking.",
  );
}
