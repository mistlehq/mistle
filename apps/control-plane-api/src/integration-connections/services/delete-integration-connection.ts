import {
  integrationConnectionCredentials,
  integrationConnections,
  integrationCredentials,
  sandboxProfileVersionIntegrationBindings,
  type ControlPlaneDatabase,
  webhookAutomations,
} from "@mistle/db/control-plane";
import { ConflictError, NotFoundError } from "@mistle/http/errors.js";
import { and, eq, inArray, sql } from "drizzle-orm";

import {
  IntegrationConnectionsConflictCodes,
  IntegrationConnectionsNotFoundCodes,
} from "../constants.js";

export type DeleteIntegrationConnectionInput = {
  organizationId: string;
  connectionId: string;
};

export async function deleteIntegrationConnection(
  ctx: { db: ControlPlaneDatabase },
  input: DeleteIntegrationConnectionInput,
): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    const [lockedConnection] = await tx
      .select({
        id: integrationConnections.id,
      })
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.organizationId, input.organizationId),
          eq(integrationConnections.id, input.connectionId),
        ),
      )
      .limit(1)
      .for("update");

    if (lockedConnection === undefined) {
      throw new NotFoundError(
        IntegrationConnectionsNotFoundCodes.CONNECTION_NOT_FOUND,
        `Integration connection '${input.connectionId}' was not found.`,
      );
    }

    const [bindingUsage] = await tx
      .select({
        bindingCount: sql<number>`count(*)::int`,
      })
      .from(sandboxProfileVersionIntegrationBindings)
      .where(eq(sandboxProfileVersionIntegrationBindings.connectionId, lockedConnection.id));

    if ((bindingUsage?.bindingCount ?? 0) > 0) {
      throw new ConflictError(
        IntegrationConnectionsConflictCodes.CONNECTION_HAS_BINDINGS,
        "This integration connection cannot be deleted while it is still used by one or more bindings.",
      );
    }

    const [automationUsage] = await tx
      .select({
        automationCount: sql<number>`count(*)::int`,
      })
      .from(webhookAutomations)
      .where(eq(webhookAutomations.integrationConnectionId, lockedConnection.id));

    if ((automationUsage?.automationCount ?? 0) > 0) {
      throw new ConflictError(
        IntegrationConnectionsConflictCodes.CONNECTION_HAS_AUTOMATIONS,
        "This integration connection cannot be deleted while it is still used by one or more webhook automations.",
      );
    }

    const linkedCredentials = await tx
      .select({
        credentialId: integrationConnectionCredentials.credentialId,
      })
      .from(integrationConnectionCredentials)
      .where(eq(integrationConnectionCredentials.connectionId, lockedConnection.id));

    await tx
      .delete(integrationConnectionCredentials)
      .where(eq(integrationConnectionCredentials.connectionId, lockedConnection.id));

    const credentialIds = linkedCredentials.map((credential) => credential.credentialId);
    if (credentialIds.length > 0) {
      await tx.delete(integrationCredentials).where(
        and(
          eq(integrationCredentials.organizationId, input.organizationId),
          inArray(integrationCredentials.id, credentialIds),
          sql`not exists (
              select 1
              from "control_plane"."integration_connection_credentials" as linked_credentials
              where linked_credentials.credential_id = ${integrationCredentials.id}
            )`,
        ),
      );
    }

    await tx
      .delete(integrationConnections)
      .where(
        and(
          eq(integrationConnections.organizationId, input.organizationId),
          eq(integrationConnections.id, lockedConnection.id),
        ),
      );
  });
}
