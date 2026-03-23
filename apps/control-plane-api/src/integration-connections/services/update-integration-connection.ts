import { integrationConnections, type ControlPlaneDatabase } from "@mistle/db/control-plane";
import { NotFoundError } from "@mistle/http/errors.js";
import { eq, sql } from "drizzle-orm";

import { IntegrationConnectionsNotFoundCodes } from "../constants.js";

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
};

export async function updateIntegrationConnection(
  { db }: { db: ControlPlaneDatabase },
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

  const [updatedConnection] = await db
    .update(integrationConnections)
    .set({
      displayName: input.displayName,
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
