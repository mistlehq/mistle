import {
  IntegrationConnectionCredentialPurposes,
  type IntegrationConnectionCredentialPurpose,
  IntegrationCredentialSecretKinds,
  type IntegrationCredentialSecretKind,
} from "@mistle/db/control-plane";
import { BadRequestError } from "@mistle/http/errors.js";
import type {
  IntegrationConnectionMethodDefinition,
  IntegrationConnectionMethodId,
} from "@mistle/integrations-core";
import { z } from "zod";

import { IntegrationConnectionsBadRequestCodes } from "../constants.js";

const UnknownRecordSchema = z.record(z.string(), z.unknown());

type FormConnectionMethod = Extract<IntegrationConnectionMethodDefinition, { kind: "form" }>;

export function resolveFormConnectionMethodOrThrow(input: {
  targetKey: string;
  methodId: IntegrationConnectionMethodId;
  connectionMethods: ReadonlyArray<IntegrationConnectionMethodDefinition>;
  invalidInputCode:
    | typeof IntegrationConnectionsBadRequestCodes.INVALID_CREATE_CONNECTION_INPUT
    | typeof IntegrationConnectionsBadRequestCodes.INVALID_UPDATE_CONNECTION_INPUT;
}): FormConnectionMethod {
  const method = input.connectionMethods.find((entry) => entry.id === input.methodId);

  if (method === undefined || method.kind !== "form") {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.FORM_CONNECTION_METHOD_NOT_SUPPORTED,
      `Integration target '${input.targetKey}' does not support form connection method '${input.methodId}'.`,
    );
  }

  if (method.configSchema === undefined) {
    throw new BadRequestError(
      input.invalidInputCode,
      `Form connection method '${input.methodId}' for integration target '${input.targetKey}' is missing a config schema.`,
    );
  }

  return method;
}

export function parseFormConnectionConfigOrThrow(input: {
  targetKey: string;
  method: FormConnectionMethod;
  config: Record<string, unknown>;
  invalidInputCode:
    | typeof IntegrationConnectionsBadRequestCodes.INVALID_CREATE_CONNECTION_INPUT
    | typeof IntegrationConnectionsBadRequestCodes.INVALID_UPDATE_CONNECTION_INPUT;
}): Record<string, unknown> {
  try {
    const configSchema = input.method.configSchema;
    if (configSchema === undefined) {
      throw new BadRequestError(
        input.invalidInputCode,
        `Form connection method '${input.method.id}' for integration target '${input.targetKey}' is missing a config schema.`,
      );
    }

    const parsedConfig = configSchema.parse(input.config);
    const parsedRecord = UnknownRecordSchema.safeParse(parsedConfig);

    if (!parsedRecord.success) {
      throw new Error(
        `Form connection method '${input.method.id}' for integration target '${input.targetKey}' resolved to a non-object config.`,
      );
    }

    return parsedRecord.data;
  } catch (error) {
    if (error instanceof BadRequestError) {
      throw error;
    }

    throw new BadRequestError(
      input.invalidInputCode,
      `Connection config for method '${input.method.id}' is invalid.`,
    );
  }
}

export function resolvePersistedSecretRefOrThrow(input: {
  secretType: string;
  invalidInputCode:
    | typeof IntegrationConnectionsBadRequestCodes.INVALID_CREATE_CONNECTION_INPUT
    | typeof IntegrationConnectionsBadRequestCodes.INVALID_UPDATE_CONNECTION_INPUT;
}): {
  secretKind: IntegrationCredentialSecretKind;
  purpose: IntegrationConnectionCredentialPurpose;
} {
  if (input.secretType === IntegrationCredentialSecretKinds.API_KEY) {
    return {
      secretKind: IntegrationCredentialSecretKinds.API_KEY,
      purpose: IntegrationConnectionCredentialPurposes.API_KEY,
    };
  }

  if (input.secretType === IntegrationCredentialSecretKinds.OAUTH2_ACCESS_TOKEN) {
    return {
      secretKind: IntegrationCredentialSecretKinds.OAUTH2_ACCESS_TOKEN,
      purpose: IntegrationConnectionCredentialPurposes.OAUTH2_ACCESS_TOKEN,
    };
  }

  if (input.secretType === IntegrationCredentialSecretKinds.OAUTH2_REFRESH_TOKEN) {
    return {
      secretKind: IntegrationCredentialSecretKinds.OAUTH2_REFRESH_TOKEN,
      purpose: IntegrationConnectionCredentialPurposes.OAUTH2_REFRESH_TOKEN,
    };
  }

  throw new BadRequestError(
    input.invalidInputCode,
    `Unsupported persisted secret type '${input.secretType}'.`,
  );
}
