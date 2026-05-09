import {
  IntegrationCredentialSecretKinds,
  type IntegrationCredentialSecretKind,
} from "@mistle/db/control-plane";
import { BadRequestError } from "@mistle/http/errors.js";
import {
  resolveIntegrationForm,
  type AnyIntegrationDefinition,
  type IntegrationConnectionMethodDefinition,
  type IntegrationConnectionMethodId,
  type IntegrationFormContext,
} from "@mistle/integrations-core";
import { z } from "zod";

import { IntegrationConnectionsBadRequestCodes } from "../constants.js";

const UnknownRecordSchema = z.record(z.string(), z.unknown());

type FormConnectionMethod = Extract<IntegrationConnectionMethodDefinition, { kind: "form" }>;
type FormConnectionSecretField = FormConnectionMethod["secretFields"][number];
type FormConnectionInvalidInputCode =
  | typeof IntegrationConnectionsBadRequestCodes.INVALID_CREATE_CONNECTION_INPUT
  | typeof IntegrationConnectionsBadRequestCodes.INVALID_UPDATE_CONNECTION_INPUT
  | typeof IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_INSTALLATION_START_INPUT
  | typeof IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_MANIFEST_START_INPUT
  | typeof IntegrationConnectionsBadRequestCodes.INVALID_PROVIDER_APP_SETUP_COMPLETE_INPUT
  | typeof IntegrationConnectionsBadRequestCodes.INVALID_SLACK_APP_MANIFEST_START_INPUT;
type PersistedSecretRef = {
  secretKind: IntegrationCredentialSecretKind;
  slotKey: string;
};

export type ParsedFormSecret = {
  field: FormConnectionSecretField;
  normalizedValue: string;
  persistedSecretRef: PersistedSecretRef;
};

export function buildFormConnectionMethodContextOrThrow(input: {
  targetKey: string;
  target: {
    familyId: string;
    variantId: string;
    config: unknown;
  };
  definition: Pick<AnyIntegrationDefinition, "kind" | "targetConfigSchema">;
  currentValue: Record<string, unknown>;
  connection?:
    | {
        id: string;
        config: unknown;
      }
    | undefined;
  invalidInputCode: FormConnectionInvalidInputCode;
}): IntegrationFormContext {
  const targetConfig = input.definition.targetConfigSchema.safeParse(input.target.config);
  if (!targetConfig.success) {
    throw new BadRequestError(
      input.invalidInputCode,
      `Integration target '${input.targetKey}' has invalid config.`,
    );
  }

  const targetRawConfig = UnknownRecordSchema.safeParse(input.target.config);
  if (!targetRawConfig.success) {
    throw new BadRequestError(
      input.invalidInputCode,
      `Integration target '${input.targetKey}' has invalid raw config.`,
    );
  }

  const targetConfigRecord = UnknownRecordSchema.safeParse(targetConfig.data);
  if (!targetConfigRecord.success) {
    throw new BadRequestError(
      input.invalidInputCode,
      `Integration target '${input.targetKey}' resolved to non-object config.`,
    );
  }

  const formContext: IntegrationFormContext = {
    familyId: input.target.familyId,
    variantId: input.target.variantId,
    kind: input.definition.kind,
    target: {
      rawConfig: targetRawConfig.data,
      config: targetConfigRecord.data,
    },
    currentValue: input.currentValue,
  };

  if (input.connection === undefined) {
    return formContext;
  }

  const connectionConfig = readExistingFormConnectionConfigOrThrow({
    connectionId: input.connection.id,
    config: input.connection.config,
    invalidInputCode: input.invalidInputCode,
  });

  return {
    ...formContext,
    connection: {
      id: input.connection.id,
      rawConfig: connectionConfig,
      config: connectionConfig,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readExistingFormConnectionConfigOrThrow(input: {
  connectionId: string;
  config: unknown;
  invalidInputCode: FormConnectionInvalidInputCode;
}): Record<string, unknown> {
  const connectionConfig = UnknownRecordSchema.safeParse(input.config);
  if (!connectionConfig.success) {
    throw new BadRequestError(
      input.invalidInputCode,
      `Integration connection '${input.connectionId}' has invalid config.`,
    );
  }

  return connectionConfig.data;
}

function readRequiredPropertyKeys(input: {
  methodId: string;
  targetKey: string;
  schema: Record<string, unknown>;
}): readonly string[] {
  const required = input.schema.required;
  if (required === undefined) {
    return [];
  }

  const parsedRequired = z.array(z.string()).safeParse(required);
  if (!parsedRequired.success) {
    throw new Error(
      `Resolved config form for method '${input.methodId}' on integration target '${input.targetKey}' has invalid required fields.`,
    );
  }

  return parsedRequired.data;
}

function readUiWidget(input: {
  propertyKey: string;
  uiSchema: Record<string, unknown>;
}): string | undefined {
  const propertyUiSchema = input.uiSchema[input.propertyKey];
  if (!isRecord(propertyUiSchema)) {
    return undefined;
  }

  const widget = propertyUiSchema["ui:widget"];
  return typeof widget === "string" ? widget : undefined;
}

function readSchemaPropertyLabel(input: {
  propertyKey: string;
  schema: Record<string, unknown>;
}): string {
  const properties = input.schema.properties;
  if (!isRecord(properties)) {
    return input.propertyKey;
  }

  const propertySchema = properties[input.propertyKey];
  if (!isRecord(propertySchema)) {
    return input.propertyKey;
  }

  const title = propertySchema.title;
  return typeof title === "string" && title.trim().length > 0 ? title : input.propertyKey;
}

function isMissingRequiredConfigValue(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }

  return typeof value === "string" && value.trim().length === 0;
}

function assertRequiredVisibleFormConfigFields(input: {
  targetKey: string;
  method: FormConnectionMethod;
  config: Record<string, unknown>;
  formContext: IntegrationFormContext | undefined;
  invalidInputCode: FormConnectionInvalidInputCode;
}): void {
  if (input.method.configForm === undefined || input.formContext === undefined) {
    return;
  }

  const configSchema = input.method.configSchema;
  if (configSchema === undefined) {
    throw new BadRequestError(
      input.invalidInputCode,
      `Form connection method '${input.method.id}' for integration target '${input.targetKey}' is missing a config schema.`,
    );
  }

  const resolvedForm = resolveIntegrationForm({
    schema: configSchema,
    form: input.method.configForm,
    context: input.formContext,
  });
  const schema = UnknownRecordSchema.parse(resolvedForm.schema ?? {});
  const uiSchema = UnknownRecordSchema.parse(resolvedForm.uiSchema ?? {});

  for (const propertyKey of readRequiredPropertyKeys({
    methodId: input.method.id,
    targetKey: input.targetKey,
    schema,
  })) {
    if (
      readUiWidget({
        propertyKey,
        uiSchema,
      }) === "hidden"
    ) {
      continue;
    }

    if (!isMissingRequiredConfigValue(input.config[propertyKey])) {
      continue;
    }

    const label = readSchemaPropertyLabel({
      propertyKey,
      schema,
    });
    throw new BadRequestError(
      input.invalidInputCode,
      `Connection config field '${label}' is required for method '${input.method.id}'.`,
    );
  }
}

export function resolveFormConnectionMethodOrThrow(input: {
  targetKey: string;
  methodId: IntegrationConnectionMethodId;
  connectionMethods: ReadonlyArray<IntegrationConnectionMethodDefinition>;
  invalidInputCode: FormConnectionInvalidInputCode;
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
  formContext?: IntegrationFormContext | undefined;
  invalidInputCode: FormConnectionInvalidInputCode;
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

    assertRequiredVisibleFormConfigFields({
      targetKey: input.targetKey,
      method: input.method,
      config: parsedRecord.data,
      formContext: input.formContext,
      invalidInputCode: input.invalidInputCode,
    });

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
  invalidInputCode: FormConnectionInvalidInputCode;
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
  invalidInputCode: FormConnectionInvalidInputCode;
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
  method: FormConnectionMethod;
  secrets: Record<string, string>;
  invalidInputCode: FormConnectionInvalidInputCode;
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

  return input.method.secretFields.flatMap((field) => {
    const rawValue = input.secrets[field.name];
    const normalizedValue = typeof rawValue === "string" ? rawValue.trim() : "";

    if (normalizedValue.length === 0) {
      if (field.optional) {
        return [];
      }

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
  method: FormConnectionMethod;
  secrets: Record<string, string>;
  invalidInputCode: FormConnectionInvalidInputCode;
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
