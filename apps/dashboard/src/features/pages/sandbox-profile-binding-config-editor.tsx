import { applySchemaDefaultsToFormData, resolveIntegrationForm } from "@mistle/integrations-core";
import { createIntegrationFormRegistry } from "@mistle/integrations-definitions/forms";
import { Alert, AlertDescription, AlertTitle, Button } from "@mistle/ui";
import Form, { type IChangeEvent } from "@rjsf/core";
import type { RJSFSchema, UiSchema } from "@rjsf/utils";
import validator from "@rjsf/validator-ajv8";

import type { IntegrationFormContext } from "../forms/integration-form-context.js";
import {
  IntegrationFormTemplates,
  IntegrationFormWidgets,
} from "../forms/integration-form-theme.js";
import type { IntegrationConnectionResourceSummary } from "../integrations/integrations-service.js";
import type { SandboxIntegrationBindingKind } from "../sandbox-profiles/sandbox-profiles-types.js";
import { isRecord } from "../shared/is-record.js";

const IntegrationRegistry = createIntegrationFormRegistry();

type JsonObject = Record<string, unknown>;
type IntegrationDefinition = NonNullable<ReturnType<typeof IntegrationRegistry.getDefinition>>;

export type SandboxProfileBindingEditorRow = {
  clientId: string;
  id?: string;
  connectionId: string;
  kind: SandboxIntegrationBindingKind;
  config: Record<string, unknown>;
};

export type IntegrationConnectionSummary = {
  id: string;
  displayName: string;
  targetKey: string;
  status: "active" | "error" | "revoked";
  resources?: readonly IntegrationConnectionResourceSummary[] | undefined;
  config?: Record<string, unknown> | undefined;
};

export type IntegrationTargetSummary = {
  targetKey: string;
  displayName: string;
  logoKey?: string | undefined;
  familyId: string;
  variantId: string;
  config: Record<string, unknown>;
  targetHealth: {
    configStatus: "valid" | "invalid";
  };
};

type BindingConfigUiModel =
  | {
      mode: "missing-connection";
    }
  | {
      mode: "no-config";
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
      defaultConfig?: Record<string, unknown> | undefined;
    };

type ResolvedBindingEditorContext = {
  definition: IntegrationDefinition;
  connection: IntegrationConnectionSummary;
  target: IntegrationTargetSummary;
  parsedTargetConfig: Record<string, unknown>;
  parsedConnectionConfig: Record<string, unknown>;
};

function resolveConnectionMethodDefinition(input: {
  definition: IntegrationDefinition;
  rawConnectionConfig: Record<string, unknown>;
}) {
  const connectionMethodId = input.rawConnectionConfig["connection_method"];
  if (typeof connectionMethodId !== "string") {
    return null;
  }

  return (
    input.definition.connectionMethods.find((method) => method.id === connectionMethodId) ?? null
  );
}

function resolveRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }

  return value;
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

function resolveSchemaProperties(schema: RJSFSchema): Record<string, unknown> {
  const properties = schema.properties;
  return isRecord(properties) ? properties : {};
}

function normalizeRjsfSchema(schema: RJSFSchema): RJSFSchema {
  const schemaRecord = resolveRecord(schema);
  const { $schema: _ignoredSchema, ...normalizedSchema } = schemaRecord;
  return normalizedSchema;
}

function resolveVisiblePropertyKeys(input: {
  schema: RJSFSchema;
  uiSchema: UiSchema<JsonObject, RJSFSchema>;
}): readonly string[] {
  return Object.keys(resolveSchemaProperties(input.schema)).filter(
    (propertyKey) => readUiWidget(input.uiSchema, propertyKey) !== "hidden",
  );
}

function hasUnsupportedConfigKeys(input: {
  schema: RJSFSchema;
  formData: Record<string, unknown>;
}): boolean {
  const supportedKeys = new Set<string>(Object.keys(resolveSchemaProperties(input.schema)));

  return Object.keys(input.formData).some((key) => !supportedKeys.has(key));
}

function createDefaultConfigFromSchema(schema: RJSFSchema): Record<string, unknown> {
  return applySchemaDefaultsToFormData({
    schema: resolveRecord(schema),
    formData: {},
  });
}

function resolveBindingDefinitionContext(input: {
  row: SandboxProfileBindingEditorRow;
  connections: readonly IntegrationConnectionSummary[];
  targets: readonly IntegrationTargetSummary[];
}):
  | {
      ok: true;
      value: ResolvedBindingEditorContext;
    }
  | {
      ok: false;
      model: BindingConfigUiModel;
    } {
  const connection = input.connections.find((candidate) => candidate.id === input.row.connectionId);
  if (connection === undefined) {
    return {
      ok: false,
      model: {
        mode: "missing-connection",
      },
    };
  }

  const target = input.targets.find((candidate) => candidate.targetKey === connection.targetKey);
  if (target === undefined) {
    return {
      ok: false,
      model: {
        mode: "unsupported",
        message: `Connection '${connection.id}' references unknown target '${connection.targetKey}'.`,
      },
    };
  }

  const definition = IntegrationRegistry.getDefinition({
    familyId: target.familyId,
    variantId: target.variantId,
  });
  if (definition === undefined) {
    return {
      ok: false,
      model: {
        mode: "unsupported",
        message: `Missing integration definition for target '${target.familyId}/${target.variantId}'.`,
      },
    };
  }

  if (definition.kind !== input.row.kind) {
    return {
      ok: false,
      model: {
        mode: "unsupported",
        message: `Binding kind '${input.row.kind}' is not compatible with target '${target.familyId}/${target.variantId}'.`,
      },
    };
  }

  const targetConfigResult = definition.targetConfigSchema.safeParse(target.config);
  if (!targetConfigResult.success) {
    return {
      ok: false,
      model: {
        mode: "unsupported",
        message: `Target '${target.familyId}/${target.variantId}' has invalid config.`,
      },
    };
  }

  const rawConnectionConfig = connection.config ?? {};
  let parsedConnectionConfig: Record<string, unknown>;
  const connectionMethodDefinition = resolveConnectionMethodDefinition({
    definition,
    rawConnectionConfig,
  });
  if (connectionMethodDefinition?.configSchema === undefined) {
    parsedConnectionConfig = rawConnectionConfig;
  } else {
    const parsedConnectionConfigResult =
      connectionMethodDefinition.configSchema.safeParse(rawConnectionConfig);
    if (!parsedConnectionConfigResult.success) {
      return {
        ok: false,
        model: {
          mode: "unsupported",
          message: `Connection '${connection.id}' has invalid config for target '${target.familyId}/${target.variantId}'. Reconnect this integration connection.`,
        },
      };
    }

    parsedConnectionConfig = parsedConnectionConfigResult.data;
  }

  return {
    ok: true,
    value: {
      definition,
      connection,
      target,
      parsedTargetConfig: targetConfigResult.data,
      parsedConnectionConfig,
    },
  };
}

function resolveFormModelFromContext(input: {
  row: SandboxProfileBindingEditorRow;
  context: ResolvedBindingEditorContext;
}): BindingConfigUiModel {
  try {
    const parsedCurrentValue = input.context.definition.bindingConfigSchema.safeParse(
      input.row.config,
    );
    const resolvedForm = resolveIntegrationForm({
      schema: input.context.definition.bindingConfigSchema,
      form: input.context.definition.bindingConfigForm,
      context: {
        familyId: input.context.target.familyId,
        variantId: input.context.target.variantId,
        kind: input.context.definition.kind,
        target: {
          rawConfig: input.context.target.config,
          config: input.context.parsedTargetConfig,
        },
        connection: {
          id: input.context.connection.id,
          rawConfig: input.context.connection.config ?? {},
          config: input.context.parsedConnectionConfig,
          ...(input.context.connection.resources === undefined
            ? {}
            : { resources: input.context.connection.resources }),
        },
        currentValue: input.row.config,
        ...(parsedCurrentValue.success ? { parsedCurrentValue: parsedCurrentValue.data } : {}),
      },
    });

    const schema = normalizeRjsfSchema(resolvedForm.schema ?? {});
    const uiSchema: UiSchema<JsonObject, RJSFSchema> = resolvedForm.uiSchema ?? {};
    const defaultConfig = createDefaultConfigFromSchema(schema);
    const normalizedValue = applySchemaDefaultsToFormData({
      schema: resolveRecord(schema),
      formData: resolveRecord(input.row.config),
    });

    if (hasUnsupportedConfigKeys({ schema, formData: input.row.config })) {
      return {
        mode: "unsupported",
        message: "Binding config contains unsupported fields for the selected target/connection.",
        defaultConfig,
      };
    }

    const visiblePropertyKeys = resolveVisiblePropertyKeys({
      schema,
      uiSchema,
    });
    if (visiblePropertyKeys.length === 0) {
      return {
        mode: "no-config",
      };
    }

    return {
      mode: "form",
      schema,
      uiSchema,
      value: normalizedValue,
      visiblePropertyKeys,
    };
  } catch (error) {
    return {
      mode: "unsupported",
      message: error instanceof Error ? error.message : "Could not resolve binding form.",
    };
  }
}

function resolveNextConfigFromChange(input: {
  row: SandboxProfileBindingEditorRow;
  nextFormData: Record<string, unknown>;
  connections: readonly IntegrationConnectionSummary[];
  targets: readonly IntegrationTargetSummary[];
}): Record<string, unknown> {
  const contextResult = resolveBindingDefinitionContext({
    row: {
      ...input.row,
      config: input.nextFormData,
    },
    connections: input.connections,
    targets: input.targets,
  });

  if (!contextResult.ok) {
    return input.nextFormData;
  }

  const nextModel = resolveFormModelFromContext({
    row: {
      ...input.row,
      config: input.nextFormData,
    },
    context: contextResult.value,
  });

  if (nextModel.mode !== "form") {
    return input.nextFormData;
  }

  return nextModel.value;
}

export function resolveBindingKindFromTarget(
  target: IntegrationTargetSummary | undefined,
): SandboxIntegrationBindingKind | undefined {
  if (target === undefined) {
    return undefined;
  }

  const definition = IntegrationRegistry.getDefinition({
    familyId: target.familyId,
    variantId: target.variantId,
  });

  return definition?.kind;
}

export function createDefaultBindingConfig(input: {
  connection?: IntegrationConnectionSummary;
  target?: IntegrationTargetSummary;
}): Record<string, unknown> {
  if (input.target === undefined || input.connection === undefined) {
    return {};
  }

  const resolvedKind = resolveBindingKindFromTarget(input.target);
  if (resolvedKind === undefined) {
    return {};
  }

  const contextResult = resolveBindingDefinitionContext({
    row: {
      clientId: "default-binding-config",
      connectionId: input.connection.id,
      kind: resolvedKind,
      config: {},
    },
    connections: [input.connection],
    targets: [input.target],
  });
  if (!contextResult.ok) {
    return {};
  }

  const resolvedModel = resolveFormModelFromContext({
    row: {
      clientId: "default-binding-config",
      connectionId: input.connection.id,
      kind: contextResult.value.definition.kind,
      config: {},
    },
    context: contextResult.value,
  });

  if (resolvedModel.mode !== "form") {
    return {};
  }

  return resolvedModel.value;
}

export function resolveBindingConfigUiModel(input: {
  row: SandboxProfileBindingEditorRow;
  connections: readonly IntegrationConnectionSummary[];
  targets: readonly IntegrationTargetSummary[];
}): BindingConfigUiModel {
  const contextResult = resolveBindingDefinitionContext(input);
  if (!contextResult.ok) {
    return contextResult.model;
  }

  return resolveFormModelFromContext({
    row: input.row,
    context: contextResult.value,
  });
}

export function SandboxProfileBindingConfigEditor(input: {
  row: SandboxProfileBindingEditorRow;
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
  layout?: "vertical" | "horizontal";
  formContext?: IntegrationFormContext | undefined;
  onIntegrationBindingRowChange: (
    clientId: string,
    changes: Partial<Omit<SandboxProfileBindingEditorRow, "clientId">>,
  ) => void;
}): React.JSX.Element {
  const configUiModel = resolveBindingConfigUiModel({
    row: input.row,
    connections: input.availableConnections,
    targets: input.availableTargets,
  });

  if (configUiModel.mode === "missing-connection") {
    return (
      <p className="text-muted-foreground text-sm">
        Select a connection to configure this binding.
      </p>
    );
  }

  if (configUiModel.mode === "unsupported") {
    return (
      <div className="gap-2 flex flex-col">
        <Alert variant="destructive">
          <AlertTitle>Unsupported binding config</AlertTitle>
          <AlertDescription>{configUiModel.message}</AlertDescription>
        </Alert>
        <div>
          <Button
            onClick={() => {
              input.onIntegrationBindingRowChange(input.row.clientId, {
                config: configUiModel.defaultConfig ?? {},
              });
            }}
            type="button"
            variant="outline"
          >
            Reset config
          </Button>
        </div>
      </div>
    );
  }

  if (configUiModel.mode === "no-config") {
    return (
      <p className="text-muted-foreground text-sm">
        No additional config required for this binding.
      </p>
    );
  }

  return (
    <Form<JsonObject, RJSFSchema, IntegrationFormContext>
      children={<></>}
      formData={configUiModel.value}
      formContext={{
        ...(input.formContext ?? {}),
        layout: input.layout ?? "vertical",
      }}
      noHtml5Validate
      onChange={(event: IChangeEvent<JsonObject, RJSFSchema>) => {
        const nextFormData = resolveRecord(event.formData);
        const nextConfig = resolveNextConfigFromChange({
          row: input.row,
          nextFormData,
          connections: input.availableConnections,
          targets: input.availableTargets,
        });

        input.onIntegrationBindingRowChange(input.row.clientId, {
          config: nextConfig,
        });
      }}
      schema={configUiModel.schema}
      showErrorList={false}
      uiSchema={configUiModel.uiSchema}
      validator={validator}
      templates={IntegrationFormTemplates}
      widgets={IntegrationFormWidgets}
    />
  );
}
