import type { IntegrationConnection } from "@mistle/db/control-plane";

type ConnectionMethodMetadata = {
  id: string;
  label: string;
};

type IntegrationConnectionResponse = {
  id: string;
  targetKey: string;
  displayName: string;
  status: IntegrationConnection["status"];
  externalSubjectId?: string;
  config?: Record<string, unknown>;
  targetSnapshotConfig?: Record<string, unknown>;
  connectionMethodId?: string;
  connectionMethodLabel?: string;
  createdAt: string;
  updatedAt: string;
};

type BuildIntegrationConnectionResponseInput = {
  connection: Pick<
    IntegrationConnection,
    | "id"
    | "targetKey"
    | "displayName"
    | "status"
    | "externalSubjectId"
    | "config"
    | "targetSnapshotConfig"
    | "createdAt"
    | "updatedAt"
  >;
  connectionMethods?: readonly ConnectionMethodMetadata[] | undefined;
};

export function buildIntegrationConnectionResponse(
  input: BuildIntegrationConnectionResponseInput,
): IntegrationConnectionResponse {
  const connectionMethodMetadata = resolveConnectionMethodMetadata({
    config: input.connection.config,
    connectionMethods: input.connectionMethods,
  });

  return {
    id: input.connection.id,
    targetKey: input.connection.targetKey,
    displayName: input.connection.displayName,
    status: input.connection.status,
    ...(input.connection.externalSubjectId === null
      ? {}
      : { externalSubjectId: input.connection.externalSubjectId }),
    ...(input.connection.config === null ? {} : { config: input.connection.config }),
    ...(input.connection.targetSnapshotConfig === null
      ? {}
      : { targetSnapshotConfig: input.connection.targetSnapshotConfig }),
    ...connectionMethodMetadata,
    createdAt: input.connection.createdAt,
    updatedAt: input.connection.updatedAt,
  };
}

function resolveConnectionMethodMetadata(input: {
  config: Record<string, unknown> | null;
  connectionMethods?: readonly ConnectionMethodMetadata[] | undefined;
}): Pick<IntegrationConnectionResponse, "connectionMethodId" | "connectionMethodLabel"> | {} {
  if (input.config === null) {
    return {};
  }

  const rawConnectionMethodId = input.config["connection_method"];
  if (typeof rawConnectionMethodId !== "string" || rawConnectionMethodId.length === 0) {
    return {};
  }

  const connectionMethod =
    input.connectionMethods?.find((method) => method.id === rawConnectionMethodId) ?? null;
  if (connectionMethod === null) {
    return {};
  }

  return {
    connectionMethodId: connectionMethod.id,
    connectionMethodLabel: connectionMethod.label,
  };
}
