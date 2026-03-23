import {
  integrationConnections,
  sandboxProfileVersionIntegrationBindings,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import { ConflictError, NotFoundError } from "@mistle/http/errors.js";
import { and, eq, sql } from "drizzle-orm";

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
  const existingConnection = await ctx.db.query.integrationConnections.findFirst({
    columns: {
      id: true,
    },
    where: (table, { and, eq }) =>
      and(eq(table.organizationId, input.organizationId), eq(table.id, input.connectionId)),
  });

  if (existingConnection === undefined) {
    throw new NotFoundError(
      IntegrationConnectionsNotFoundCodes.CONNECTION_NOT_FOUND,
      `Integration connection '${input.connectionId}' was not found.`,
    );
  }

  const [bindingUsage] = await ctx.db
    .select({
      bindingCount: sql<number>`count(*)::int`,
    })
    .from(sandboxProfileVersionIntegrationBindings)
    .where(eq(sandboxProfileVersionIntegrationBindings.connectionId, input.connectionId));

  if ((bindingUsage?.bindingCount ?? 0) > 0) {
    throw new ConflictError(
      IntegrationConnectionsConflictCodes.CONNECTION_HAS_BINDINGS,
      "This integration connection cannot be deleted while it is still used by one or more bindings.",
    );
  }

  await ctx.db
    .delete(integrationConnections)
    .where(
      and(
        eq(integrationConnections.organizationId, input.organizationId),
        eq(integrationConnections.id, input.connectionId),
      ),
    );
}
