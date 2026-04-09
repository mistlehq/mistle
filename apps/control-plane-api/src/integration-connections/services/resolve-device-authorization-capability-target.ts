import type { ControlPlaneDatabase, IntegrationTarget } from "@mistle/db/control-plane";
import { BadRequestError, NotFoundError } from "@mistle/http/errors.js";
import type {
  IntegrationConnectionMethodDefinition,
  IntegrationDeviceAuthorizationCapability,
  IntegrationDeviceAuthorizationConnectionMethodDefinition,
  IntegrationRegistry,
} from "@mistle/integrations-core";
import { z } from "zod";

import { resolveIntegrationTargetSecrets } from "../../lib/integration-target-secrets.js";
import {
  IntegrationConnectionsBadRequestCodes,
  IntegrationConnectionsNotFoundCodes,
} from "../constants.js";

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

async function resolveEnabledTargetOrThrow(
  db: ControlPlaneDatabase,
  targetKey: string,
): Promise<IntegrationTarget> {
  const target = await db.query.integrationTargets.findFirst({
    where: (table, { and, eq }) => and(eq(table.targetKey, targetKey), eq(table.enabled, true)),
  });

  if (target === undefined) {
    throw new NotFoundError(
      IntegrationConnectionsNotFoundCodes.TARGET_NOT_FOUND,
      `Integration target '${targetKey}' was not found.`,
    );
  }

  return target;
}

function resolveDeviceAuthorizationConnectionMethodOrThrow(input: {
  targetKey: string;
  methodId: string;
  connectionMethods: ReadonlyArray<IntegrationConnectionMethodDefinition>;
}): IntegrationDeviceAuthorizationConnectionMethodDefinition {
  const method = input.connectionMethods.find((candidate) => candidate.id === input.methodId);

  if (method === undefined || method.kind !== "device-authorization") {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.DEVICE_AUTH_NOT_SUPPORTED,
      `Integration target '${input.targetKey}' does not support device authorization connection method '${input.methodId}'.`,
    );
  }

  return method;
}

export type ResolvedDeviceAuthorizationCapabilityTarget = {
  target: {
    targetKey: string;
    familyId: string;
    variantId: string;
    enabled: true;
    config: Record<string, unknown>;
    secrets: Record<string, string>;
  };
  connectionMethod: IntegrationDeviceAuthorizationConnectionMethodDefinition;
  deviceAuthorization: IntegrationDeviceAuthorizationCapability<
    Record<string, unknown>,
    Record<string, string>,
    Record<string, unknown>
  >;
};

export async function resolveDeviceAuthorizationCapabilityTargetOrThrow(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
    integrationsConfig: {
      activeMasterEncryptionKeyVersion: number;
      masterEncryptionKeys: Record<string, string>;
    };
  },
  input: {
    targetKey: string;
    methodId: string;
    invalidInputCode:
      | "INVALID_DEVICE_AUTH_START_INPUT"
      | "INVALID_DEVICE_AUTH_STATUS_INPUT"
      | "INVALID_DEVICE_AUTH_CANCEL_INPUT";
  },
): Promise<ResolvedDeviceAuthorizationCapabilityTarget> {
  const target = await resolveEnabledTargetOrThrow(ctx.db, input.targetKey);
  const definition = ctx.integrationRegistry.getDefinition({
    familyId: target.familyId,
    variantId: target.variantId,
  });

  if (definition === undefined) {
    throw new BadRequestError(
      input.invalidInputCode,
      `Integration definition '${target.familyId}/${target.variantId}' is not registered.`,
    );
  }

  const connectionMethod = resolveDeviceAuthorizationConnectionMethodOrThrow({
    targetKey: input.targetKey,
    methodId: input.methodId,
    connectionMethods: definition.connectionMethods,
  });

  const deviceAuthorization = definition.deviceAuthorization;
  if (deviceAuthorization === undefined) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.DEVICE_AUTH_CAPABILITY_NOT_CONFIGURED,
      `Integration target '${input.targetKey}' does not define a device authorization capability.`,
    );
  }

  const targetSecrets = resolveIntegrationTargetSecrets({
    integrationsConfig: ctx.integrationsConfig,
    target: {
      targetKey: target.targetKey,
      secrets: target.secrets,
    },
  });

  let parsedConfig: Record<string, unknown>;
  try {
    const parsedConfigCandidate = definition.targetConfigSchema.parse(target.config);
    const targetConfigRecord = toUnknownRecord(parsedConfigCandidate);
    if (targetConfigRecord === null) {
      throw new Error("Target config must be an object.");
    }
    parsedConfig = targetConfigRecord;
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new BadRequestError(
        input.invalidInputCode,
        `Integration target '${input.targetKey}' has invalid target config for '${target.familyId}/${target.variantId}'.`,
      );
    }

    throw error;
  }

  let parsedSecrets: Record<string, string>;
  try {
    const parsedSecretsCandidate = definition.targetSecretSchema.parse(targetSecrets);
    const targetSecretsRecord = toStringRecord(parsedSecretsCandidate);
    if (targetSecretsRecord === null) {
      throw new Error("Target secrets must be a string record.");
    }
    parsedSecrets = targetSecretsRecord;
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new BadRequestError(
        input.invalidInputCode,
        `Integration target '${input.targetKey}' has invalid target secrets for '${target.familyId}/${target.variantId}'.`,
      );
    }

    throw error;
  }

  return {
    target: {
      targetKey: target.targetKey,
      familyId: target.familyId,
      variantId: target.variantId,
      enabled: true,
      config: parsedConfig,
      secrets: parsedSecrets,
    },
    connectionMethod,
    deviceAuthorization,
  };
}
