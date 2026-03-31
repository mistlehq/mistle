import { applySchemaDefaultsToFormData, resolveIntegrationForm } from "@mistle/integrations-core";
import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { createIntegrationFormRegistry } from "@mistle/integrations-definitions/forms";
import type { RJSFSchema, UiSchema } from "@rjsf/utils";

import type {
  IntegrationConnectionDialogState,
  IntegrationConnectionMethodId,
} from "../integrations/integration-connection-dialog.js";
import type { IntegrationConnectionMethod } from "../integrations/integrations-service-shared.js";
import { isRecord } from "../shared/is-record.js";
import type { OpenIntegrationConnectionDialogInput } from "./integration-connection-dialog-state-types.js";

const IntegrationRegistry = createIntegrationFormRegistry();

type JsonObject = Record<string, unknown>;

export type ConnectionMethodFormUiModel =
  | {
      mode: "none";
    }
  | {
      mode: "form";
      schema: RJSFSchema;
      uiSchema: UiSchema<JsonObject, RJSFSchema>;
      value: Record<string, unknown>;
      visiblePropertyKeys: readonly string[];
    }
  | {
      mode: "unsupported";
      message: string;
    };

export type IntegrationConnectionDialogDraft = {
  configValue: Record<string, unknown>;
  connectionDisplayNamePlaceholder: string;
  connectionDisplayNameValue: string;
  error: string | null;
  initialConfigValue: Record<string, unknown>;
  methodId: IntegrationConnectionMethodId;
  secrets: Record<string, string>;
};

function resolveRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }

  return value;
}

function normalizeSchema(schema: RJSFSchema): RJSFSchema {
  const schemaRecord = resolveRecord(schema);
  const { $schema: _ignoredSchema, ...normalizedSchema } = schemaRecord;
  return normalizedSchema;
}

function resolveRjsfSchema(value: unknown): RJSFSchema {
  return normalizeSchema(resolveRecord(value));
}

function resolveRjsfUiSchema(value: unknown): UiSchema<JsonObject, RJSFSchema> {
  return resolveRecord(value);
}

function readUiWidget(
  uiSchema: UiSchema<JsonObject, RJSFSchema>,
  propertyKey: string,
): string | undefined {
  const propertyUiSchema = uiSchema[propertyKey];
  if (!isRecord(propertyUiSchema)) {
    return undefined;
  }

  const widget = propertyUiSchema["ui:widget"];
  return typeof widget === "string" ? widget : undefined;
}

function resolveVisiblePropertyKeys(input: {
  schema: RJSFSchema;
  uiSchema: UiSchema<JsonObject, RJSFSchema>;
}): readonly string[] {
  const properties = resolveRecord(input.schema.properties);

  return Object.keys(properties).filter(
    (propertyKey) => readUiWidget(input.uiSchema, propertyKey) !== "hidden",
  );
}

function resolveSelectedMethod(input: {
  dialog: IntegrationConnectionDialogState;
  methodId: IntegrationConnectionMethodId;
}): IntegrationConnectionMethod | null {
  if (input.dialog.mode === "update") {
    return input.dialog.currentMethod.id === input.methodId ? input.dialog.currentMethod : null;
  }

  return input.dialog.methods.find((method) => method.id === input.methodId) ?? null;
}

export function resolveConnectionMethodFormUiModel(input: {
  dialog: IntegrationConnectionDialogState;
  methodId: IntegrationConnectionMethodId;
  currentValue: Record<string, unknown>;
}): ConnectionMethodFormUiModel {
  const definition =
    IntegrationRegistry.getDefinition({
      familyId: input.dialog.targetFamilyId,
      variantId: input.dialog.targetVariantId,
    }) ?? null;
  if (definition === null) {
    return {
      mode: "unsupported",
      message: `Missing integration definition for target '${input.dialog.targetFamilyId}/${input.dialog.targetVariantId}'.`,
    };
  }

  const targetConfigResult = definition.targetConfigSchema.safeParse(input.dialog.targetConfig);
  if (!targetConfigResult.success) {
    return {
      mode: "unsupported",
      message: `Target '${input.dialog.targetFamilyId}/${input.dialog.targetVariantId}' has invalid config.`,
    };
  }

  const methodDefinition =
    definition.connectionMethods.find((method) => method.id === input.methodId) ?? null;
  if (methodDefinition === null) {
    return {
      mode: "unsupported",
      message: `Missing connection method '${input.methodId}' for target '${input.dialog.targetKey}'.`,
    };
  }

  if (methodDefinition.kind !== "form" || methodDefinition.configSchema === undefined) {
    return {
      mode: "none",
    };
  }

  const parsedCurrentValueResult = methodDefinition.configSchema.safeParse(input.currentValue);
  const resolvedForm = resolveIntegrationForm({
    schema: methodDefinition.configSchema,
    form: methodDefinition.configForm,
    context: {
      familyId: input.dialog.targetFamilyId,
      variantId: input.dialog.targetVariantId,
      kind: definition.kind,
      target: {
        rawConfig: input.dialog.targetConfig,
        config: targetConfigResult.data,
      },
      currentValue: input.currentValue,
      ...(parsedCurrentValueResult.success
        ? {
            parsedCurrentValue: parsedCurrentValueResult.data,
          }
        : {}),
      ...(input.dialog.mode === "update"
        ? {
            connection: {
              id: input.dialog.connectionId,
              rawConfig: input.dialog.currentConnectionConfig,
              config:
                input.dialog.currentMethod.id === input.methodId
                  ? resolveRecord(input.dialog.currentConnectionConfig)
                  : {},
            },
          }
        : {}),
    },
  });

  const schema = resolveRjsfSchema(resolvedForm.schema);
  const uiSchema = resolveRjsfUiSchema(resolvedForm.uiSchema ?? {});
  const value = applySchemaDefaultsToFormData({
    schema: resolveRecord(schema),
    formData: input.currentValue,
  });

  return {
    mode: "form",
    schema,
    uiSchema,
    value,
    visiblePropertyKeys: resolveVisiblePropertyKeys({
      schema,
      uiSchema,
    }),
  };
}

function resolveInitialConfigValue(input: {
  dialog: IntegrationConnectionDialogState;
  methodId: IntegrationConnectionMethodId;
}): Record<string, unknown> {
  const baseValue =
    input.dialog.mode === "update" && input.dialog.currentMethod.id === input.methodId
      ? input.dialog.currentConnectionConfig
      : {};

  const formUiModel = resolveConnectionMethodFormUiModel({
    dialog: input.dialog,
    methodId: input.methodId,
    currentValue: baseValue,
  });

  if (formUiModel.mode !== "form") {
    return {};
  }

  return formUiModel.value;
}

export function createClosedIntegrationConnectionDialogDraft(
  defaultMethodId: IntegrationConnectionMethodId,
): IntegrationConnectionDialogDraft {
  return {
    configValue: {},
    connectionDisplayNamePlaceholder: "",
    connectionDisplayNameValue: "",
    error: null,
    initialConfigValue: {},
    methodId: defaultMethodId,
    secrets: {},
  };
}

export function createOpenIntegrationConnectionDialogState(input: {
  defaultMethodId: IntegrationConnectionMethodId;
  openInput: OpenIntegrationConnectionDialogInput;
}): {
  dialog: IntegrationConnectionDialogState;
  draft: IntegrationConnectionDialogDraft;
} {
  const supportedMethods =
    input.openInput.mode === "create"
      ? input.openInput.methods.map((method) => method.id)
      : [input.openInput.currentMethod.id];
  const defaultMethod = supportedMethods[0];
  if (defaultMethod === undefined) {
    throw new Error(
      `Integration target '${input.openInput.targetKey}' does not declare any supported connection methods.`,
    );
  }

  const existingConnectionDisplayName =
    input.openInput.mode === "update" ? input.openInput.connectionDisplayName : undefined;
  const defaultConnectionDisplayName =
    input.openInput.mode === "update"
      ? (existingConnectionDisplayName ?? input.openInput.connectionId ?? "")
      : `${input.openInput.targetDisplayName} connection`;

  const dialog: IntegrationConnectionDialogState =
    input.openInput.mode === "create"
      ? {
          targetConfig: input.openInput.targetConfig,
          targetDisplayName: input.openInput.targetDisplayName,
          targetFamilyId: input.openInput.targetFamilyId,
          targetKey: input.openInput.targetKey,
          targetVariantId: input.openInput.targetVariantId,
          mode: input.openInput.mode,
          methods: input.openInput.methods,
        }
      : {
          connectionId: input.openInput.connectionId,
          currentConnectionConfig: input.openInput.connectionConfig ?? {},
          currentMethod: input.openInput.currentMethod,
          targetConfig: input.openInput.targetConfig,
          targetDisplayName: input.openInput.targetDisplayName,
          targetFamilyId: input.openInput.targetFamilyId,
          targetKey: input.openInput.targetKey,
          targetVariantId: input.openInput.targetVariantId,
          mode: input.openInput.mode,
          ...(input.openInput.connectionConfig === undefined
            ? {}
            : { connectionConfig: input.openInput.connectionConfig }),
          ...(existingConnectionDisplayName === undefined
            ? {}
            : { initialConnectionDisplayName: existingConnectionDisplayName }),
        };

  const initialConfigValue = resolveInitialConfigValue({
    dialog,
    methodId: defaultMethod ?? input.defaultMethodId,
  });

  return {
    dialog,
    draft: {
      configValue: initialConfigValue,
      connectionDisplayNamePlaceholder: defaultConnectionDisplayName,
      connectionDisplayNameValue: existingConnectionDisplayName ?? "",
      error: null,
      initialConfigValue,
      methodId: defaultMethod ?? input.defaultMethodId,
      secrets: {},
    },
  };
}

function areConfigsEqual(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function hasIntegrationConnectionDialogChanges(input: {
  dialog: IntegrationConnectionDialogState | null;
  connectionDisplayNamePlaceholder: string;
  connectionDisplayNameValue: string;
  configValue: Record<string, unknown>;
  initialConfigValue: Record<string, unknown>;
  secrets: Record<string, string>;
}): boolean {
  if (input.dialog?.mode === "create") {
    return true;
  }

  return (
    (
      input.dialog?.initialConnectionDisplayName ?? input.connectionDisplayNamePlaceholder
    ).trim() !== input.connectionDisplayNameValue.trim() ||
    !areConfigsEqual(input.initialConfigValue, input.configValue) ||
    Object.values(input.secrets).some((value) => value.trim().length > 0)
  );
}

export function isIntegrationConnectionDisplayNameChanged(input: {
  dialog: IntegrationConnectionDialogState | null;
  connectionDisplayNamePlaceholder: string;
  connectionDisplayNameValue: string;
}): boolean {
  if (input.dialog?.mode !== "update") {
    return input.connectionDisplayNameValue.trim().length > 0;
  }

  return (
    (input.dialog.initialConnectionDisplayName ?? input.connectionDisplayNamePlaceholder).trim() !==
    input.connectionDisplayNameValue.trim()
  );
}

export function resolveIntegrationConnectionDialogValidationError(input: {
  dialog: IntegrationConnectionDialogState;
  methodId: IntegrationConnectionMethodId;
  connectionDisplayNameValue: string;
  secrets: Record<string, string>;
}): string | null {
  const selectedMethod = resolveSelectedMethod({
    dialog: input.dialog,
    methodId: input.methodId,
  });
  if (selectedMethod === null) {
    throw new Error(
      `Connect method '${input.methodId}' is not supported for target '${input.dialog.targetKey}'.`,
    );
  }

  const normalizedConnectionDisplayName = input.connectionDisplayNameValue.trim();
  if (normalizedConnectionDisplayName.length === 0) {
    return "Connection name is required.";
  }

  if (selectedMethod.kind !== "form") {
    return null;
  }

  if (input.dialog.mode === "create") {
    const missingSecretField = selectedMethod.secretFields.find(
      (secretField) => (input.secrets[secretField.name] ?? "").trim().length === 0,
    );

    if (missingSecretField !== undefined) {
      return `${missingSecretField.label} is required.`;
    }
  }

  return null;
}

export function resolveDefaultMethodId(
  methods: readonly IntegrationConnectionMethod[],
): IntegrationConnectionMethodId {
  const apiKeyMethod = methods.find(
    (method) => method.id === IntegrationConnectionMethodIds.API_KEY,
  );
  return apiKeyMethod?.id ?? methods[0]?.id ?? IntegrationConnectionMethodIds.API_KEY;
}

export function resolveNextDraftForMethodChange(input: {
  dialog: IntegrationConnectionDialogState;
  nextMethodId: IntegrationConnectionMethodId;
  currentDraft: IntegrationConnectionDialogDraft;
}): IntegrationConnectionDialogDraft {
  const nextInitialConfigValue = resolveInitialConfigValue({
    dialog: input.dialog,
    methodId: input.nextMethodId,
  });

  return {
    ...input.currentDraft,
    configValue: nextInitialConfigValue,
    error: null,
    initialConfigValue: nextInitialConfigValue,
    methodId: input.nextMethodId,
    secrets: {},
  };
}
