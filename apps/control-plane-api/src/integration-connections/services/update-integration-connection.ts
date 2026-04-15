import { integrationConnections, type ControlPlaneDatabase } from "@mistle/db/control-plane";
import { BadRequestError, NotFoundError } from "@mistle/http/errors.js";
import type { IntegrationRegistry } from "@mistle/integrations-core";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import {
  IntegrationConnectionsBadRequestCodes,
  IntegrationConnectionsNotFoundCodes,
} from "../constants.js";

const UnknownRecordSchema = z.record(z.string(), z.unknown());

type UpdatedConnection = {
  id: string;
  targetKey: string;
  displayName: string;
  status: "active" | "error" | "revoked";
  externalSubjectId?: string;
  config?: Record<string, unknown>;
  targetSnapshotConfig?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type UpdateConnectionInput = {
  organizationId: string;
  connectionId: string;
  displayName: string;
  config?: Record<string, unknown>;
};

function parseNonFormConnectionConfigOrThrow(input: {
  targetKey: string;
  method:
    | {
        kind: "redirect";
        id: string;
        startConfigSchema?: z.ZodType<Record<string, unknown>>;
      }
    | {
        kind: "device-authorization";
        id: string;
        configSchema?: z.ZodType<Record<string, unknown>>;
      };
  config: Record<string, unknown>;
}): Record<string, unknown> {
  const schema =
    input.method.kind === "redirect" ? input.method.startConfigSchema : input.method.configSchema;

  if (schema === undefined) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.INVALID_UPDATE_CONNECTION_INPUT,
      `Connection config for method '${input.method.id}' is not editable for integration target '${input.targetKey}'.`,
    );
  }

  try {
    const parsedConfig = schema.parse(input.config);
    const parsedRecord = UnknownRecordSchema.safeParse(parsedConfig);

    if (!parsedRecord.success) {
      throw new Error(
        `Connection method '${input.method.id}' for integration target '${input.targetKey}' resolved to a non-object config.`,
      );
    }

    return parsedRecord.data;
  } catch (error) {
    if (error instanceof BadRequestError) {
      throw error;
    }

    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.INVALID_UPDATE_CONNECTION_INPUT,
      `Connection config for method '${input.method.id}' is invalid.`,
    );
  }
}

export async function updateIntegrationConnection(
  {
    db,
    integrationRegistry,
  }: { db: ControlPlaneDatabase; integrationRegistry: IntegrationRegistry },
  input: UpdateConnectionInput,
): Promise<UpdatedConnection> {
  const existingConnection = await db.query.integrationConnections.findFirst({
    where: (table, { and, eq }) =>
      and(eq(table.id, input.connectionId), eq(table.organizationId, input.organizationId)),
  });

  if (existingConnection === undefined) {
    throw new NotFoundError(
      IntegrationConnectionsNotFoundCodes.CONNECTION_NOT_FOUND,
      `Integration connection '${input.connectionId}' was not found.`,
    );
  }

  let nextConfig: Record<string, unknown> | undefined;

  if (input.config !== undefined) {
    const connectionMethodIdValue = existingConnection.config?.["connection_method"];
    const existingConnectionMethodId =
      typeof connectionMethodIdValue === "string" && connectionMethodIdValue.length > 0
        ? connectionMethodIdValue
        : null;
    if (existingConnectionMethodId === null) {
      throw new BadRequestError(
        IntegrationConnectionsBadRequestCodes.INVALID_UPDATE_CONNECTION_INPUT,
        `Integration connection '${input.connectionId}' is missing a connection method.`,
      );
    }

    const target = await db.query.integrationTargets.findFirst({
      where: (table, { eq }) => eq(table.targetKey, existingConnection.targetKey),
    });

    if (target === undefined) {
      throw new NotFoundError(
        IntegrationConnectionsNotFoundCodes.TARGET_NOT_FOUND,
        `Integration target '${existingConnection.targetKey}' was not found.`,
      );
    }

    const definition = integrationRegistry.getDefinition({
      familyId: target.familyId,
      variantId: target.variantId,
    });

    if (definition === undefined) {
      throw new BadRequestError(
        IntegrationConnectionsBadRequestCodes.INVALID_UPDATE_CONNECTION_INPUT,
        `Integration definition '${target.familyId}/${target.variantId}' is not registered.`,
      );
    }

    const method = definition.connectionMethods.find(
      (candidate) => candidate.id === existingConnectionMethodId,
    );

    if (method === undefined || method.kind === "form") {
      throw new BadRequestError(
        method === undefined
          ? IntegrationConnectionsBadRequestCodes.INVALID_UPDATE_CONNECTION_INPUT
          : IntegrationConnectionsBadRequestCodes.FORM_CONNECTION_REQUIRED,
        method === undefined
          ? `Missing connection method '${existingConnectionMethodId}' for target '${existingConnection.targetKey}'.`
          : `Integration connection '${input.connectionId}' requires the form update endpoint.`,
      );
    }

    const parsedConfig = parseNonFormConnectionConfigOrThrow({
      targetKey: existingConnection.targetKey,
      method,
      config: input.config,
    });

    nextConfig = {
      ...(existingConnection.config ?? {}),
      ...parsedConfig,
      connection_method: existingConnectionMethodId,
    };
  }

  const [updatedConnection] = await db
    .update(integrationConnections)
    .set({
      displayName: input.displayName,
      ...(nextConfig === undefined ? {} : { config: nextConfig }),
      updatedAt: sql`now()`,
    })
    .where(eq(integrationConnections.id, existingConnection.id))
    .returning();

  if (updatedConnection === undefined) {
    throw new Error("Failed to update integration connection.");
  }

  return {
    id: updatedConnection.id,
    targetKey: updatedConnection.targetKey,
    displayName: updatedConnection.displayName,
    status: updatedConnection.status,
    ...(updatedConnection.externalSubjectId === null
      ? {}
      : { externalSubjectId: updatedConnection.externalSubjectId }),
    ...(updatedConnection.config === null ? {} : { config: updatedConnection.config }),
    ...(updatedConnection.targetSnapshotConfig === null
      ? {}
      : { targetSnapshotConfig: updatedConnection.targetSnapshotConfig }),
    createdAt: updatedConnection.createdAt,
    updatedAt: updatedConnection.updatedAt,
  };
}
