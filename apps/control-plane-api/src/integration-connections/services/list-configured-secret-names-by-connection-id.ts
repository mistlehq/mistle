import { type ControlPlaneDatabase, getControlPlaneDatabaseSchema } from "@mistle/db/control-plane";
import type {
  IntegrationConnectionMethodDefinition,
  IntegrationRegistry,
} from "@mistle/integrations-core";
import { inArray } from "drizzle-orm";

type TargetMetadata = {
  familyId: string;
  variantId: string;
};

type ConnectionInput = {
  id: string;
  config: Record<string, unknown> | null;
  target: TargetMetadata | null;
};

type FormConnectionMethod = Extract<IntegrationConnectionMethodDefinition, { kind: "form" }>;

function resolveFormConnectionMethod(input: {
  connection: ConnectionInput;
  integrationRegistry: IntegrationRegistry;
}): FormConnectionMethod | null {
  if (input.connection.target === null || input.connection.config === null) {
    return null;
  }

  const rawConnectionMethodId = input.connection.config["connection_method"];
  if (typeof rawConnectionMethodId !== "string" || rawConnectionMethodId.length === 0) {
    return null;
  }

  const definition = input.integrationRegistry.getDefinition({
    familyId: input.connection.target.familyId,
    variantId: input.connection.target.variantId,
  });
  if (definition === undefined) {
    return null;
  }

  const method = definition.connectionMethods.find(
    (entry): entry is FormConnectionMethod =>
      entry.kind === "form" && entry.id === rawConnectionMethodId,
  );

  return method ?? null;
}

export async function listConfiguredSecretNamesByConnectionId(input: {
  connections: readonly ConnectionInput[];
  db: ControlPlaneDatabase;
  integrationRegistry: IntegrationRegistry;
}): Promise<Map<string, string[]>> {
  const tables = getControlPlaneDatabaseSchema(input.db);

  if (input.connections.length === 0) {
    return new Map();
  }

  const secretFieldNameByConnectionIdAndSlotKey = new Map<string, string>();

  for (const connection of input.connections) {
    const method = resolveFormConnectionMethod({
      connection,
      integrationRegistry: input.integrationRegistry,
    });
    if (method === null) {
      continue;
    }

    for (const field of method.secretFields) {
      if (field.slotKey === undefined) {
        continue;
      }

      secretFieldNameByConnectionIdAndSlotKey.set(`${connection.id}:${field.slotKey}`, field.name);
    }
  }

  if (secretFieldNameByConnectionIdAndSlotKey.size === 0) {
    return new Map();
  }

  const rows = await input.db
    .select({
      connectionId: tables.integrationConnectionCredentials.connectionId,
      slotKey: tables.integrationConnectionCredentials.slotKey,
    })
    .from(tables.integrationConnectionCredentials)
    .where(
      inArray(
        tables.integrationConnectionCredentials.connectionId,
        input.connections.map((entry) => entry.id),
      ),
    );

  const configuredSecretNamesByConnectionId = new Map<string, string[]>();

  for (const row of rows) {
    const secretFieldName = secretFieldNameByConnectionIdAndSlotKey.get(
      `${row.connectionId}:${row.slotKey}`,
    );
    if (secretFieldName === undefined) {
      continue;
    }

    const existingNames = configuredSecretNamesByConnectionId.get(row.connectionId) ?? [];
    if (!existingNames.includes(secretFieldName)) {
      configuredSecretNamesByConnectionId.set(row.connectionId, [
        ...existingNames,
        secretFieldName,
      ]);
    }
  }

  for (const [connectionId, configuredSecretNames] of configuredSecretNamesByConnectionId) {
    configuredSecretNamesByConnectionId.set(connectionId, [...configuredSecretNames].sort());
  }

  return configuredSecretNamesByConnectionId;
}
