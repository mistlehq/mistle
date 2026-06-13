import { type ControlPlaneDatabase, getControlPlaneDatabaseSchema } from "@mistle/db/control-plane";
import { BadRequestError } from "@mistle/http/errors.js";
import type { IntegrationRegistry } from "@mistle/integrations-core";
import { eq, sql } from "drizzle-orm";

import { resolveIntegrationCredential } from "../../internal/integration-credentials/services/resolve-credential.js";
import type { AppContext } from "../../types.js";
import { IntegrationConnectionsBadRequestCodes } from "../constants.js";
import { buildIntegrationConnectionResponse } from "./build-integration-connection-response.js";
import {
  resolveConnectionConfigOrThrow,
  resolveConnectionWithTargetOrThrow,
  resolveStringCredentialValueOrThrow,
} from "./webhook-sources.js";

type RepairIntegrationConnectionResult = ReturnType<typeof buildIntegrationConnectionResponse>;

export async function repairIntegrationConnection(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
    integrationsConfig: AppContext["var"]["config"]["integrations"];
  },
  input: {
    organizationId: string;
    connectionId: string;
  },
): Promise<RepairIntegrationConnectionResult> {
  const connection = await resolveConnectionWithTargetOrThrow({
    db: ctx.db,
    organizationId: input.organizationId,
    connectionId: input.connectionId,
  });
  const connectionConfig = resolveConnectionConfigOrThrow({
    connectionId: connection.id,
    config: connection.config,
  });
  const definition = ctx.integrationRegistry.getDefinition({
    familyId: connection.target.familyId,
    variantId: connection.target.variantId,
  });

  if (definition === undefined || definition.connectionRepair === undefined) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.CONNECTION_REPAIR_NOT_SUPPORTED,
      `Integration connection '${connection.id}' does not support repair.`,
    );
  }

  const parsedTargetConfig = definition.targetConfigSchema.parse(connection.target.config);
  const parsedTargetSecrets = definition.targetSecretSchema.parse(connection.target.secrets ?? {});
  let repairResult;
  try {
    repairResult = await definition.connectionRepair.repair({
      organizationId: input.organizationId,
      targetKey: connection.targetKey,
      target: {
        familyId: connection.target.familyId,
        variantId: connection.target.variantId,
        enabled: connection.target.enabled,
        config: parsedTargetConfig,
        secrets: parsedTargetSecrets,
      },
      connection: {
        id: connection.id,
        status: connection.status,
        config: connectionConfig,
      },
      resolveConnectionSecret: async ({ secretType, slotKey }) => {
        const credential = await resolveIntegrationCredential(
          {
            db: ctx.db,
            integrationRegistry: ctx.integrationRegistry,
            integrationsConfig: ctx.integrationsConfig,
          },
          {
            connectionId: connection.id,
            secretType,
            slotKey,
          },
        );

        return resolveStringCredentialValueOrThrow({
          credential,
          context: "Integration connection repair",
        });
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Integration connection repair failed. Reconnect this integration.";
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.CONNECTION_REPAIR_FAILED,
      message,
    );
  }

  const tables = getControlPlaneDatabaseSchema(ctx.db);
  const [updatedConnection] = await ctx.db
    .update(tables.integrationConnections)
    .set({
      config: repairResult.config ?? connectionConfig,
      ...(repairResult.externalSubjectId === undefined
        ? {}
        : { externalSubjectId: repairResult.externalSubjectId }),
      updatedAt: sql`now()`,
    })
    .where(eq(tables.integrationConnections.id, connection.id))
    .returning();

  if (updatedConnection === undefined) {
    throw new Error(`Failed to repair integration connection '${connection.id}'.`);
  }

  return buildIntegrationConnectionResponse({
    connection: updatedConnection,
    connectionMethods: definition.connectionMethods,
  });
}
