import type { IntegrationConnection, IntegrationTarget } from "@mistle/db/control-plane";
import {
  IntegrationCredentialSecretKinds,
  type IntegrationCredentialSecretKind,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import { BadRequestError } from "@mistle/http/errors.js";
import type {
  AnyIntegrationDefinition,
  IdentityLinkingConnectionSecretResolver,
  IntegrationConnectionMethodDefinition,
  IntegrationRegistry,
  IntegrationResolvedTarget,
} from "@mistle/integrations-core";
import { z } from "zod";

import { resolveIntegrationTargetSecrets } from "../../lib/integration-target-secrets.js";
import { IdentityLinkingBadRequestCodes } from "../constants.js";
import { resolveConnectionSecretOrThrow } from "./resolve-connection-secret.js";

function toUnknownRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const record: Record<string, unknown> = {};
  for (const [key, entryValue] of Object.entries(value)) {
    record[key] = entryValue;
  }

  return record;
}

function toStringRecord(value: unknown): Record<string, string> | null {
  const record = toUnknownRecord(value);
  if (record === null) {
    return null;
  }

  const stringRecord: Record<string, string> = {};
  for (const [key, entryValue] of Object.entries(record)) {
    if (typeof entryValue !== "string") {
      return null;
    }

    stringRecord[key] = entryValue;
  }

  return stringRecord;
}

function resolveConnectionMethodIdOrThrow(input: {
  connection: Pick<IntegrationConnection, "id" | "config">;
}): string {
  if (input.connection.config === null) {
    throw new BadRequestError(
      IdentityLinkingBadRequestCodes.INVALID_PROVIDER_CONFIG_INPUT,
      `Integration connection '${input.connection.id}' is missing config.`,
    );
  }

  const rawConnectionMethodId = input.connection.config.connection_method;
  if (typeof rawConnectionMethodId !== "string" || rawConnectionMethodId.length === 0) {
    throw new BadRequestError(
      IdentityLinkingBadRequestCodes.INVALID_PROVIDER_CONFIG_INPUT,
      `Integration connection '${input.connection.id}' is missing a connection method.`,
    );
  }

  return rawConnectionMethodId;
}

function resolveConnectionMethodOrThrow(input: {
  definition: AnyIntegrationDefinition;
  connection: Pick<IntegrationConnection, "id" | "config">;
}): IntegrationConnectionMethodDefinition<
  Record<string, unknown>,
  Record<string, string>,
  Record<string, unknown>,
  Record<string, unknown>
> {
  const connectionMethodId = resolveConnectionMethodIdOrThrow({
    connection: input.connection,
  });
  const connectionMethod =
    input.definition.connectionMethods.find((method) => method.id === connectionMethodId) ?? null;

  if (connectionMethod === null) {
    throw new BadRequestError(
      IdentityLinkingBadRequestCodes.INVALID_PROVIDER_CONFIG_INPUT,
      `Integration connection '${input.connection.id}' uses unknown connection method '${connectionMethodId}'.`,
    );
  }

  return connectionMethod;
}

function resolveIntegrationCredentialSecretKindOrThrow(
  secretType: string,
): IntegrationCredentialSecretKind {
  for (const secretKind of Object.values(IntegrationCredentialSecretKinds)) {
    if (secretKind === secretType) {
      return secretKind;
    }
  }

  throw new Error(`Integration connection secret type '${secretType}' is not supported.`);
}

export function resolveIdentityLinkingDefinitionOrThrow(input: {
  integrationRegistry: IntegrationRegistry;
  target: Pick<IntegrationTarget, "familyId" | "variantId" | "targetKey">;
}): AnyIntegrationDefinition & {
  identityLinking: NonNullable<AnyIntegrationDefinition["identityLinking"]>;
} {
  const definition = input.integrationRegistry.getDefinition({
    familyId: input.target.familyId,
    variantId: input.target.variantId,
  });

  if (definition === undefined) {
    throw new Error(
      `Integration definition '${input.target.familyId}/${input.target.variantId}' is not registered.`,
    );
  }

  if (definition.identityLinking === undefined) {
    throw new Error(
      `Integration definition '${input.target.familyId}/${input.target.variantId}' does not define identity linking.`,
    );
  }

  return {
    ...definition,
    identityLinking: definition.identityLinking,
  };
}

export async function supportsIdentityLinkingConnection(input: {
  definition: AnyIntegrationDefinition & {
    identityLinking: NonNullable<AnyIntegrationDefinition["identityLinking"]>;
  };
  connection: Pick<IntegrationConnection, "id" | "config">;
  availableConnectionSecretSlotKeys: ReadonlySet<string>;
}): Promise<boolean> {
  if (input.definition.identityLinking.supportsConnection === undefined) {
    return true;
  }

  const connectionMethod = resolveConnectionMethodOrThrow({
    definition: input.definition,
    connection: input.connection,
  });
  let parsedConnectionConfig: unknown;
  try {
    parsedConnectionConfig = connectionMethod.configSchema?.parse(input.connection.config);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new BadRequestError(
        IdentityLinkingBadRequestCodes.INVALID_PROVIDER_CONFIG_INPUT,
        `Integration connection '${input.connection.id}' has invalid connection config for identity linking.`,
      );
    }

    throw error;
  }

  const connectionConfig = toUnknownRecord(parsedConnectionConfig ?? input.connection.config);

  if (connectionConfig === null) {
    throw new Error("Identity-linking connection config must be an object.");
  }

  return input.definition.identityLinking.supportsConnection({
    connection: {
      id: input.connection.id,
      status: "active",
      config: connectionConfig,
    },
    availableConnectionSecretSlotKeys: input.availableConnectionSecretSlotKeys,
  });
}

export async function resolveIdentityLinkingRuntimeContextOrThrow(input: {
  db: ControlPlaneDatabase;
  integrationRegistry: IntegrationRegistry;
  integrationsConfig: {
    activeMasterEncryptionKeyVersion: number;
    masterEncryptionKeys: Record<string, string>;
  };
  organizationId: string;
  integrationTarget: Pick<
    IntegrationTarget,
    "targetKey" | "familyId" | "variantId" | "enabled" | "config" | "secrets"
  >;
  integrationConnection: Pick<
    IntegrationConnection,
    "id" | "status" | "externalSubjectId" | "config"
  >;
}) {
  const definition = resolveIdentityLinkingDefinitionOrThrow({
    integrationRegistry: input.integrationRegistry,
    target: input.integrationTarget,
  });
  const connectionMethod = resolveConnectionMethodOrThrow({
    definition,
    connection: input.integrationConnection,
  });

  let targetConfig: Record<string, unknown>;
  try {
    const parsedTargetConfig = definition.targetConfigSchema.parse(input.integrationTarget.config);
    const parsedTargetConfigRecord = toUnknownRecord(parsedTargetConfig);
    if (parsedTargetConfigRecord === null) {
      throw new Error("Identity-linking target config must be an object.");
    }

    targetConfig = parsedTargetConfigRecord;
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new BadRequestError(
        IdentityLinkingBadRequestCodes.INVALID_PROVIDER_CONFIG_INPUT,
        `Integration target '${input.integrationTarget.targetKey}' has invalid target config for '${input.integrationTarget.familyId}/${input.integrationTarget.variantId}'.`,
      );
    }

    throw error;
  }

  let targetSecrets: Record<string, string>;
  try {
    const parsedTargetSecrets = definition.targetSecretSchema.parse(
      resolveIntegrationTargetSecrets({
        integrationsConfig: input.integrationsConfig,
        target: input.integrationTarget,
      }),
    );
    const parsedTargetSecretsRecord = toStringRecord(parsedTargetSecrets);
    if (parsedTargetSecretsRecord === null) {
      throw new Error("Identity-linking target secrets must be a string record.");
    }

    targetSecrets = parsedTargetSecretsRecord;
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new BadRequestError(
        IdentityLinkingBadRequestCodes.INVALID_PROVIDER_CONFIG_INPUT,
        `Integration target '${input.integrationTarget.targetKey}' has invalid target secrets for '${input.integrationTarget.familyId}/${input.integrationTarget.variantId}'.`,
      );
    }

    throw error;
  }

  let connectionConfig: Record<string, unknown>;
  try {
    const parsedConnectionConfig = connectionMethod.configSchema?.parse(
      input.integrationConnection.config,
    );
    const parsedConnectionConfigRecord = toUnknownRecord(
      parsedConnectionConfig ?? input.integrationConnection.config,
    );
    if (parsedConnectionConfigRecord === null) {
      throw new Error("Identity-linking connection config must be an object.");
    }

    connectionConfig = parsedConnectionConfigRecord;
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new BadRequestError(
        IdentityLinkingBadRequestCodes.INVALID_PROVIDER_CONFIG_INPUT,
        `Integration connection '${input.integrationConnection.id}' has invalid config for '${input.integrationTarget.familyId}/${input.integrationTarget.variantId}'.`,
      );
    }

    throw error;
  }

  const resolveConnectionSecret: IdentityLinkingConnectionSecretResolver = async ({ slotKey }) => {
    const secretField = connectionMethod.secretFields?.find((field) => field.slotKey === slotKey);
    if (secretField === undefined) {
      throw new BadRequestError(
        IdentityLinkingBadRequestCodes.INVALID_PROVIDER_CONFIG_INPUT,
        `Integration connection '${input.integrationConnection.id}' does not define secret slot '${slotKey}'.`,
      );
    }

    return resolveConnectionSecretOrThrow({
      db: input.db,
      organizationId: input.organizationId,
      connectionId: input.integrationConnection.id,
      slotKey,
      secretKind: resolveIntegrationCredentialSecretKindOrThrow(secretField.secretType),
      integrationsConfig: input.integrationsConfig,
    });
  };

  return {
    definition,
    identityLinking: definition.identityLinking,
    target: {
      familyId: input.integrationTarget.familyId,
      variantId: input.integrationTarget.variantId,
      enabled: input.integrationTarget.enabled,
      config: targetConfig,
      secrets: targetSecrets,
    } satisfies IntegrationResolvedTarget<Record<string, unknown>, Record<string, string>>,
    connection: {
      id: input.integrationConnection.id,
      status: input.integrationConnection.status,
      ...(input.integrationConnection.externalSubjectId === undefined ||
      input.integrationConnection.externalSubjectId === null
        ? {}
        : { externalSubjectId: input.integrationConnection.externalSubjectId }),
      config: connectionConfig,
    },
    resolveConnectionSecret,
  };
}
