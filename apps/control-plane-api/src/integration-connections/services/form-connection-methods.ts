import {
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
type FormConnectionSecretField = FormConnectionMethod["secretFields"][number];
type PersistedSecretRef = {
  secretKind: IntegrationCredentialSecretKind;
  slotKey: string;
};

export type ParsedFormSecret = {
  field: FormConnectionSecretField;
  normalizedValue: string;
  persistedSecretRef: PersistedSecretRef;
};

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
  slotKey: string;
  secretType: string;
  invalidInputCode:
    | typeof IntegrationConnectionsBadRequestCodes.INVALID_CREATE_CONNECTION_INPUT
    | typeof IntegrationConnectionsBadRequestCodes.INVALID_UPDATE_CONNECTION_INPUT;
}): PersistedSecretRef {
  if (input.secretType === IntegrationCredentialSecretKinds.API_KEY) {
    return {
      secretKind: IntegrationCredentialSecretKinds.API_KEY,
      slotKey: input.slotKey,
    };
  }

  if (input.secretType === IntegrationCredentialSecretKinds.AWS_SECRET_ACCESS_KEY) {
    return {
      secretKind: IntegrationCredentialSecretKinds.AWS_SECRET_ACCESS_KEY,
      slotKey: input.slotKey,
    };
  }

  if (input.secretType === IntegrationCredentialSecretKinds.OAUTH2_ACCESS_TOKEN) {
    return {
      secretKind: IntegrationCredentialSecretKinds.OAUTH2_ACCESS_TOKEN,
      slotKey: input.slotKey,
    };
  }

  if (input.secretType === IntegrationCredentialSecretKinds.OAUTH2_REFRESH_TOKEN) {
    return {
      secretKind: IntegrationCredentialSecretKinds.OAUTH2_REFRESH_TOKEN,
      slotKey: input.slotKey,
    };
  }

  if (input.secretType === IntegrationCredentialSecretKinds.OAUTH2_CLIENT_SECRET) {
    return {
      secretKind: IntegrationCredentialSecretKinds.OAUTH2_CLIENT_SECRET,
      slotKey: input.slotKey,
    };
  }

  throw new BadRequestError(
    input.invalidInputCode,
    `Unsupported persisted secret type '${input.secretType}'.`,
  );
}

function createSecretFieldsByNameOrThrow(input: {
  method: FormConnectionMethod;
  invalidInputCode:
    | typeof IntegrationConnectionsBadRequestCodes.INVALID_CREATE_CONNECTION_INPUT
    | typeof IntegrationConnectionsBadRequestCodes.INVALID_UPDATE_CONNECTION_INPUT;
}): Map<string, FormConnectionSecretField> {
  const fieldsByName = new Map<string, FormConnectionSecretField>();

  for (const field of input.method.secretFields) {
    if (field.name.trim().length === 0) {
      throw new BadRequestError(
        input.invalidInputCode,
        `Form connection method '${input.method.id}' contains a secret field with an empty name.`,
      );
    }

    if (fieldsByName.has(field.name)) {
      throw new BadRequestError(
        input.invalidInputCode,
        `Form connection method '${input.method.id}' contains duplicate secret field '${field.name}'.`,
      );
    }

    fieldsByName.set(field.name, field);
  }

  return fieldsByName;
}

export function parseCreateFormSecretsOrThrow(input: {
  targetKey: string;
  method: FormConnectionMethod;
  secrets: Record<string, string>;
  invalidInputCode:
    | typeof IntegrationConnectionsBadRequestCodes.INVALID_CREATE_CONNECTION_INPUT
    | typeof IntegrationConnectionsBadRequestCodes.INVALID_UPDATE_CONNECTION_INPUT;
}): ParsedFormSecret[] {
  const fieldsByName = createSecretFieldsByNameOrThrow(input);

  for (const fieldName of Object.keys(input.secrets)) {
    if (!fieldsByName.has(fieldName)) {
      throw new BadRequestError(
        input.invalidInputCode,
        `Connection secret '${fieldName}' is not supported for method '${input.method.id}'.`,
      );
    }
  }

  return input.method.secretFields.map((field) => {
    const rawValue = input.secrets[field.name];
    const normalizedValue = typeof rawValue === "string" ? rawValue.trim() : "";

    if (normalizedValue.length === 0) {
      throw new BadRequestError(
        input.invalidInputCode,
        `Secret field '${field.label}' is required for method '${input.method.id}'.`,
      );
    }

    return {
      field,
      normalizedValue,
      persistedSecretRef: resolvePersistedSecretRefOrThrow({
        slotKey: field.slotKey,
        secretType: field.secretType,
        invalidInputCode: input.invalidInputCode,
      }),
    };
  });
}

export function parseUpdateFormSecretsOrThrow(input: {
  targetKey: string;
  method: FormConnectionMethod;
  secrets: Record<string, string>;
  invalidInputCode:
    | typeof IntegrationConnectionsBadRequestCodes.INVALID_CREATE_CONNECTION_INPUT
    | typeof IntegrationConnectionsBadRequestCodes.INVALID_UPDATE_CONNECTION_INPUT;
}): ParsedFormSecret[] {
  const fieldsByName = createSecretFieldsByNameOrThrow(input);
  const parsedSecrets: ParsedFormSecret[] = [];

  for (const [fieldName, rawValue] of Object.entries(input.secrets)) {
    const field = fieldsByName.get(fieldName);
    if (field === undefined) {
      throw new BadRequestError(
        input.invalidInputCode,
        `Connection secret '${fieldName}' is not supported for method '${input.method.id}'.`,
      );
    }

    const normalizedValue = rawValue.trim();
    if (normalizedValue.length === 0) {
      throw new BadRequestError(
        input.invalidInputCode,
        `Secret field '${field.label}' must contain at least one non-whitespace character when provided.`,
      );
    }

    parsedSecrets.push({
      field,
      normalizedValue,
      persistedSecretRef: resolvePersistedSecretRefOrThrow({
        slotKey: field.slotKey,
        secretType: field.secretType,
        invalidInputCode: input.invalidInputCode,
      }),
    });
  }

  return parsedSecrets;
}
