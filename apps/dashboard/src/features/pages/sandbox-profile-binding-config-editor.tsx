import {
  buildBindingEditorRenderableFields,
  createDefaultConfigFromBindingEditorVariant,
  parseConfigAgainstBindingEditorVariant,
  parseIntegrationBindingEditorUiProjection,
  resolveBindingEditorVariant,
  type BindingEditorRenderableField,
  type BindingEditorVariant,
  updateBindingEditorConfigByField,
} from "@mistle/integrations-definitions/ui";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Field,
  FieldContent,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@mistle/ui";

import type { SandboxIntegrationBindingKind } from "../sandbox-profiles/sandbox-profiles-types.js";

export type SandboxProfileBindingEditorRow = {
  clientId: string;
  id?: string;
  connectionId: string;
  kind: SandboxIntegrationBindingKind;
  config: Record<string, unknown>;
};

export type IntegrationConnectionSummary = {
  id: string;
  targetKey: string;
  status: "active" | "error" | "revoked";
  config?: Record<string, unknown> | undefined;
};

export type IntegrationTargetSummary = {
  targetKey: string;
  displayName: string;
  familyId: string;
  variantId: string;
  targetHealth: {
    configStatus: "valid" | "invalid";
  };
  resolvedBindingEditorUi?: Record<string, unknown> | undefined;
};

type BindingConfigUiModel =
  | {
      mode: "missing-connection";
    }
  | {
      mode: "editor";
      variant: BindingEditorVariant;
      value: Record<string, unknown>;
      fields: readonly BindingEditorRenderableField[];
    }
  | {
      mode: "connector";
    }
  | {
      mode: "unsupported";
      message: string;
      defaultConfig?: Record<string, unknown> | undefined;
    };

export function resolveBindingKindFromTarget(
  target: IntegrationTargetSummary | undefined,
): SandboxIntegrationBindingKind | undefined {
  if (target === undefined) {
    return undefined;
  }
  const projection = parseIntegrationBindingEditorUiProjection(target.resolvedBindingEditorUi);
  return projection?.bindingEditor.kind;
}

export function createDefaultBindingConfig(input: {
  connection?: IntegrationConnectionSummary;
  target?: IntegrationTargetSummary;
}): Record<string, unknown> {
  if (input.target === undefined || input.connection === undefined) {
    return {};
  }
  const projection = parseIntegrationBindingEditorUiProjection(
    input.target.resolvedBindingEditorUi,
  );
  if (projection === undefined) {
    return {};
  }
  const resolvedVariant = resolveBindingEditorVariant({
    projection,
    ...(input.connection.config === undefined ? {} : { connectionConfig: input.connection.config }),
  });
  if (!resolvedVariant.ok) {
    return {};
  }
  return createDefaultConfigFromBindingEditorVariant({
    variant: resolvedVariant.variant,
  });
}

export function resolveBindingConfigUiModel(input: {
  row: SandboxProfileBindingEditorRow;
  connections: readonly IntegrationConnectionSummary[];
  targets: readonly IntegrationTargetSummary[];
}): BindingConfigUiModel {
  const connection = input.connections.find((candidate) => candidate.id === input.row.connectionId);
  if (connection === undefined) {
    return {
      mode: "missing-connection",
    };
  }

  const target = input.targets.find((candidate) => candidate.targetKey === connection.targetKey);
  if (target === undefined) {
    return {
      mode: "unsupported",
      message: `Connection '${connection.id}' references unknown target '${connection.targetKey}'.`,
    };
  }

  const projection = parseIntegrationBindingEditorUiProjection(target.resolvedBindingEditorUi);
  if (projection === undefined) {
    return {
      mode: "unsupported",
      message: `Target '${target.familyId}/${target.variantId}' does not define binding editor UI metadata.`,
    };
  }

  if (projection.bindingEditor.kind !== input.row.kind) {
    return {
      mode: "unsupported",
      message: `Binding kind '${input.row.kind}' is not compatible with target '${target.familyId}/${target.variantId}'.`,
    };
  }

  const resolvedVariant = resolveBindingEditorVariant({
    projection,
    ...(connection.config === undefined ? {} : { connectionConfig: connection.config }),
  });
  if (!resolvedVariant.ok) {
    return {
      mode: "unsupported",
      message: resolvedVariant.message,
    };
  }

  const defaultConfig = createDefaultConfigFromBindingEditorVariant({
    variant: resolvedVariant.variant,
  });
  const parsedConfig = parseConfigAgainstBindingEditorVariant({
    config: input.row.config,
    variant: resolvedVariant.variant,
  });
  if (!parsedConfig.ok) {
    return {
      mode: "unsupported",
      message: parsedConfig.message,
      defaultConfig,
    };
  }

  return {
    mode: "editor",
    variant: resolvedVariant.variant,
    value: parsedConfig.value,
    fields: buildBindingEditorRenderableFields({
      variant: resolvedVariant.variant,
      value: parsedConfig.value,
    }),
  };
}

export function SandboxProfileBindingConfigEditor(input: {
  row: SandboxProfileBindingEditorRow;
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
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
    const selectedConnection = input.availableConnections.find(
      (connection) => connection.id === input.row.connectionId,
    );
    const selectedTarget =
      selectedConnection === undefined
        ? undefined
        : input.availableTargets.find(
            (target) => target.targetKey === selectedConnection.targetKey,
          );

    return (
      <div className="gap-2 flex flex-col">
        <Alert variant="destructive">
          <AlertTitle>Unsupported binding config</AlertTitle>
          <AlertDescription>{configUiModel.message}</AlertDescription>
        </Alert>
        <div>
          <Button
            onClick={() => {
              const resolvedKind = resolveBindingKindFromTarget(selectedTarget);
              const resetConfig =
                configUiModel.defaultConfig ??
                createDefaultBindingConfig({
                  ...(selectedConnection === undefined ? {} : { connection: selectedConnection }),
                  ...(selectedTarget === undefined ? {} : { target: selectedTarget }),
                });
              input.onIntegrationBindingRowChange(input.row.clientId, {
                ...(resolvedKind === undefined ? {} : { kind: resolvedKind }),
                config: resetConfig,
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

  if (configUiModel.mode === "connector") {
    return (
      <p className="text-muted-foreground text-sm">
        Connector bindings currently do not require additional config.
      </p>
    );
  }

  if (configUiModel.mode !== "editor") {
    throw new Error("Unsupported binding config ui mode.");
  }

  return (
    <div className="gap-3 flex flex-col">
      {configUiModel.fields.map((field) => {
        if (field.type === "select") {
          return (
            <Field key={field.key}>
              <FieldLabel htmlFor={`binding-field-${field.key}-${input.row.clientId}`}>
                {field.label}
              </FieldLabel>
              <FieldContent>
                <Select
                  onValueChange={(nextValue) => {
                    if (nextValue === null) {
                      throw new Error(`Binding config value for '${field.key}' must not be null.`);
                    }
                    if (!field.options.some((option) => option.value === nextValue)) {
                      throw new Error(
                        `Unsupported binding config value '${nextValue}' for field '${field.key}'.`,
                      );
                    }
                    const nextConfig = updateBindingEditorConfigByField({
                      variant: configUiModel.variant,
                      currentConfig: configUiModel.value,
                      fieldKey: field.key,
                      nextValue,
                    });
                    input.onIntegrationBindingRowChange(input.row.clientId, {
                      config: nextConfig,
                    });
                  }}
                  value={field.value}
                >
                  <SelectTrigger
                    aria-label={field.label}
                    id={`binding-field-${field.key}-${input.row.clientId}`}
                  >
                    <SelectValue placeholder={`Select ${field.label.toLowerCase()}`} />
                  </SelectTrigger>
                  <SelectContent>
                    {field.options.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldContent>
            </Field>
          );
        }

        return (
          <Field key={field.key}>
            <FieldLabel htmlFor={`binding-field-${field.key}-${input.row.clientId}`}>
              {field.label}
            </FieldLabel>
            <FieldContent>
              <Input
                id={`binding-field-${field.key}-${input.row.clientId}`}
                onChange={(event) => {
                  const values = event.currentTarget.value
                    .split(field.delimiter)
                    .map((entry) => entry.trim())
                    .filter((entry) => entry.length > 0);
                  const nextConfig = updateBindingEditorConfigByField({
                    variant: configUiModel.variant,
                    currentConfig: configUiModel.value,
                    fieldKey: field.key,
                    nextValue: values,
                  });
                  input.onIntegrationBindingRowChange(input.row.clientId, {
                    config: nextConfig,
                  });
                }}
                value={field.value.join(`${field.delimiter} `)}
              />
            </FieldContent>
          </Field>
        );
      })}
    </div>
  );
}
