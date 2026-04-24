import { applySchemaDefaultsToFormData, resolveIntegrationForm } from "@mistle/integrations-core";
import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { createBrowserDefinitionsBundle } from "@mistle/integrations-definitions/browser";
import { createIntegrationFormRegistry } from "@mistle/integrations-definitions/forms";
import type { RJSFSchema, UiSchema } from "@rjsf/utils";

import type {
  IntegrationConnectionEditorState,
  IntegrationConnectionMethodId,
} from "../integrations/integration-connection-editor.js";
import { resolveSelectedConnectionMethod } from "../integrations/integration-connection-method-selection.js";
import type { IntegrationConnectionMethod } from "../integrations/integrations-service-shared.js";
import { isRecord } from "../shared/is-record.js";
import type { OpenIntegrationConnectionEditorInput } from "./integration-connection-editor-state-types.js";

const Definitions = createBrowserDefinitionsBundle();
const IntegrationRegistry = createIntegrationFormRegistry(Definitions);

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

export type IntegrationConnectionEditorDraft = {
  configValue: Record<string, unknown>;
  connectionDisplayNamePlaceholder: string;
  connectionDisplayNameValue: string;
  error: string | null;
  initialConfigValue: Record<string, unknown>;
  methodId: IntegrationConnectionMethodId;
  secrets: Record<string, string>;
};

export type ConnectionMethodVisibleConfigField = {
  label: string;
  value: string;
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

export function resolveConnectionMethodFormUiModel(input: {
  editor: IntegrationConnectionEditorState;
  methodId: IntegrationConnectionMethodId;
  currentValue: Record<string, unknown>;
}): ConnectionMethodFormUiModel {
  if (input.methodId.length === 0) {
    return {
      mode: "none",
    };
  }

  const definition =
    IntegrationRegistry.getDefinition({
      familyId: input.editor.targetFamilyId,
      variantId: input.editor.targetVariantId,
    }) ?? null;
  if (definition === null) {
    return {
      mode: "unsupported",
      message: `Missing integration definition for target '${input.editor.targetFamilyId}/${input.editor.targetVariantId}'.`,
    };
  }

  const targetConfigResult = definition.targetConfigSchema.safeParse(input.editor.targetConfig);
  if (!targetConfigResult.success) {
    return {
      mode: "unsupported",
      message: `Target '${input.editor.targetFamilyId}/${input.editor.targetVariantId}' has invalid config.`,
    };
  }

  const methodDefinition =
    definition.connectionMethods.find((method) => method.id === input.methodId) ?? null;
  if (methodDefinition === null) {
    return {
      mode: "unsupported",
      message: `Missing connection method '${input.methodId}' for target '${input.editor.targetKey}'.`,
    };
  }

  const configSchema =
    methodDefinition.kind === "redirect"
      ? methodDefinition.startConfigSchema
      : methodDefinition.configSchema;
  const configFormDefinition =
    methodDefinition.kind === "redirect"
      ? methodDefinition.startConfigForm
      : methodDefinition.configForm;

  if (configSchema === undefined) {
    return {
      mode: "none",
    };
  }

  const parsedCurrentValueResult = configSchema.safeParse(input.currentValue);
  const resolvedForm = resolveIntegrationForm({
    schema: configSchema,
    form: configFormDefinition,
    context: {
      familyId: input.editor.targetFamilyId,
      variantId: input.editor.targetVariantId,
      kind: definition.kind,
      target: {
        rawConfig: input.editor.targetConfig,
        config: targetConfigResult.data,
      },
      currentValue: input.currentValue,
      definitions: Definitions,
      ...(parsedCurrentValueResult.success
        ? {
            parsedCurrentValue: parsedCurrentValueResult.data,
          }
        : {}),
      ...(input.editor.mode === "update"
        ? {
            connection: {
              id: input.editor.connectionId,
              rawConfig: input.editor.currentConnectionConfig,
              config:
                input.editor.currentMethod.id === input.methodId
                  ? resolveRecord(input.editor.currentConnectionConfig)
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

function resolveSchemaPropertyLabel(input: { propertyKey: string; schema: RJSFSchema }): string {
  const properties = resolveRecord(input.schema.properties);
  const propertySchema = resolveRecord(properties[input.propertyKey]);
  const title = propertySchema["title"];

  return typeof title === "string" && title.trim().length > 0 ? title : input.propertyKey;
}

function resolveMetadataFieldValue(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmedValue = value.trim();
    return trimmedValue.length === 0 ? null : trimmedValue;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    const renderedItems = value
      .map((item) => (typeof item === "string" || typeof item === "number" ? String(item) : null))
      .filter((item) => item !== null);

    return renderedItems.length === 0 ? null : renderedItems.join(", ");
  }

  return null;
}

export function resolveVisibleConnectionMethodConfigFields(input: {
  connectionId: string;
  connectionMethod: IntegrationConnectionMethod;
  connectionConfig: Record<string, unknown>;
  targetConfig: Record<string, unknown>;
  targetFamilyId: string;
  targetKey: string;
  targetVariantId: string;
}): readonly ConnectionMethodVisibleConfigField[] {
  const formUiModel = resolveConnectionMethodFormUiModel({
    editor: {
      connectionId: input.connectionId,
      currentConnectionConfig: input.connectionConfig,
      currentMethod: input.connectionMethod,
      mode: "update",
      targetConfig: input.targetConfig,
      targetDisplayName: input.targetKey,
      targetFamilyId: input.targetFamilyId,
      targetKey: input.targetKey,
      targetVariantId: input.targetVariantId,
      connectionConfig: input.connectionConfig,
    },
    methodId: input.connectionMethod.id,
    currentValue: input.connectionConfig,
  });

  if (formUiModel.mode !== "form") {
    return [];
  }

  return formUiModel.visiblePropertyKeys.reduce<ConnectionMethodVisibleConfigField[]>(
    (fields, propertyKey) => {
      const value = resolveMetadataFieldValue(formUiModel.value[propertyKey]);
      if (value === null) {
        return fields;
      }

      fields.push({
        label: resolveSchemaPropertyLabel({
          propertyKey,
          schema: formUiModel.schema,
        }),
        value,
      });
      return fields;
    },
    [],
  );
}

function resolveInitialConfigValue(input: {
  editor: IntegrationConnectionEditorState;
  methodId: IntegrationConnectionMethodId;
}): Record<string, unknown> {
  const baseValue =
    input.editor.mode === "update" && input.editor.currentMethod.id === input.methodId
      ? input.editor.currentConnectionConfig
      : {};

  const formUiModel = resolveConnectionMethodFormUiModel({
    editor: input.editor,
    methodId: input.methodId,
    currentValue: baseValue,
  });

  if (formUiModel.mode !== "form") {
    return {};
  }

  return formUiModel.value;
}

export function createInitialIntegrationConnectionEditorState(input: {
  defaultMethodId: IntegrationConnectionMethodId;
  initialEditorInput: OpenIntegrationConnectionEditorInput;
}): {
  editor: IntegrationConnectionEditorState;
  draft: IntegrationConnectionEditorDraft;
} {
  const supportedMethods =
    input.initialEditorInput.mode === "create"
      ? input.initialEditorInput.methods.map((method) => method.id)
      : [input.initialEditorInput.currentMethod.id];
  if (supportedMethods[0] === undefined) {
    throw new Error(
      `Integration target '${input.initialEditorInput.targetKey}' does not declare any supported connection methods.`,
    );
  }
  const selectedMethodId =
    input.initialEditorInput.mode === "create"
      ? input.defaultMethodId
      : input.initialEditorInput.currentMethod.id;

  const existingConnectionDisplayName =
    input.initialEditorInput.mode === "update"
      ? input.initialEditorInput.connectionDisplayName
      : undefined;
  const defaultConnectionDisplayName =
    input.initialEditorInput.mode === "update"
      ? (existingConnectionDisplayName ?? input.initialEditorInput.connectionId ?? "")
      : `${input.initialEditorInput.targetDisplayName} connection`;

  const editor: IntegrationConnectionEditorState =
    input.initialEditorInput.mode === "create"
      ? {
          targetConfig: input.initialEditorInput.targetConfig,
          targetDisplayName: input.initialEditorInput.targetDisplayName,
          targetFamilyId: input.initialEditorInput.targetFamilyId,
          targetKey: input.initialEditorInput.targetKey,
          targetVariantId: input.initialEditorInput.targetVariantId,
          mode: input.initialEditorInput.mode,
          methods: input.initialEditorInput.methods,
        }
      : {
          connectionId: input.initialEditorInput.connectionId,
          currentConnectionConfig: input.initialEditorInput.connectionConfig ?? {},
          currentMethod: input.initialEditorInput.currentMethod,
          targetConfig: input.initialEditorInput.targetConfig,
          targetDisplayName: input.initialEditorInput.targetDisplayName,
          targetFamilyId: input.initialEditorInput.targetFamilyId,
          targetKey: input.initialEditorInput.targetKey,
          targetVariantId: input.initialEditorInput.targetVariantId,
          mode: input.initialEditorInput.mode,
          ...(input.initialEditorInput.connectionConfig === undefined
            ? {}
            : { connectionConfig: input.initialEditorInput.connectionConfig }),
          ...(existingConnectionDisplayName === undefined
            ? {}
            : { initialConnectionDisplayName: existingConnectionDisplayName }),
        };

  const initialConfigValue = resolveInitialConfigValue({
    editor,
    methodId: selectedMethodId,
  });

  return {
    editor,
    draft: {
      configValue: initialConfigValue,
      connectionDisplayNamePlaceholder: defaultConnectionDisplayName,
      connectionDisplayNameValue: existingConnectionDisplayName ?? "",
      error: null,
      initialConfigValue,
      methodId: selectedMethodId,
      secrets: {},
    },
  };
}

function areConfigsEqual(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function hasIntegrationConnectionEditorChanges(input: {
  editor: IntegrationConnectionEditorState;
  connectionDisplayNamePlaceholder: string;
  connectionDisplayNameValue: string;
  configValue: Record<string, unknown>;
  initialConfigValue: Record<string, unknown>;
  secrets: Record<string, string>;
}): boolean {
  if (input.editor.mode === "create") {
    return true;
  }

  return (
    (input.editor.initialConnectionDisplayName ?? input.connectionDisplayNamePlaceholder).trim() !==
      input.connectionDisplayNameValue.trim() ||
    !areConfigsEqual(input.initialConfigValue, input.configValue) ||
    Object.values(input.secrets).some((value) => value.trim().length > 0)
  );
}

export function isIntegrationConnectionDisplayNameChanged(input: {
  editor: IntegrationConnectionEditorState;
  connectionDisplayNamePlaceholder: string;
  connectionDisplayNameValue: string;
}): boolean {
  if (input.editor.mode !== "update") {
    return input.connectionDisplayNameValue.trim().length > 0;
  }

  return (
    (input.editor.initialConnectionDisplayName ?? input.connectionDisplayNamePlaceholder).trim() !==
    input.connectionDisplayNameValue.trim()
  );
}

export function resolveIntegrationConnectionEditorValidationError(input: {
  editor: IntegrationConnectionEditorState;
  methodId: IntegrationConnectionMethodId;
  connectionDisplayNameValue: string;
  secrets: Record<string, string>;
}): string | null {
  if (input.editor.mode === "create" && input.methodId.length === 0) {
    return "Authentication method is required.";
  }

  const selectedMethod = resolveSelectedConnectionMethod({
    editor: input.editor,
    methodId: input.methodId,
  });
  if (selectedMethod === null) {
    throw new Error(
      `Connect method '${input.methodId}' is not supported for target '${input.editor.targetKey}'.`,
    );
  }

  const normalizedConnectionDisplayName = input.connectionDisplayNameValue.trim();
  if (normalizedConnectionDisplayName.length === 0) {
    return "Connection name is required.";
  }

  if (selectedMethod.kind !== "form") {
    return null;
  }

  if (input.editor.mode === "create") {
    if (
      input.editor.targetFamilyId === "github" &&
      input.methodId === IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION
    ) {
      return null;
    }

    const missingSecretField = selectedMethod.secretFields.find(
      (secretField) =>
        secretField.optional !== true &&
        (input.secrets[secretField.name] ?? "").trim().length === 0,
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
  if (methods.length > 1) {
    return "";
  }

  return methods[0]?.id ?? IntegrationConnectionMethodIds.API_KEY;
}

export function resolveNextDraftForMethodChange(input: {
  editor: IntegrationConnectionEditorState;
  nextMethodId: IntegrationConnectionMethodId;
  currentDraft: IntegrationConnectionEditorDraft;
}): IntegrationConnectionEditorDraft {
  const nextInitialConfigValue = resolveInitialConfigValue({
    editor: input.editor,
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
