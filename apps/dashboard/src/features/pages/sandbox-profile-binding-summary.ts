import {
  resolveBindingConfigUiModel,
  type IntegrationConnectionSummary,
  type IntegrationTargetSummary,
  type SandboxProfileBindingEditorRow,
} from "./sandbox-profile-binding-config-editor.js";

export type SandboxProfileBindingSummaryItem = {
  label: string;
  value: string;
};

function isBindingSummaryValue(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readBindingSummaryValue(record: object, key: string): unknown {
  for (const [entryKey, entryValue] of Object.entries(record)) {
    if (entryKey === key) {
      return entryValue;
    }
  }

  return undefined;
}

function resolvePropertyTitle(input: {
  schema: object;
  uiSchema: object;
  propertyKey: string;
}): string {
  const propertyUiSchema = readBindingSummaryValue(input.uiSchema, input.propertyKey);
  if (isBindingSummaryValue(propertyUiSchema)) {
    const uiTitle = readBindingSummaryValue(propertyUiSchema, "ui:title");
    if (typeof uiTitle === "string" && uiTitle.length > 0) {
      return uiTitle;
    }
  }

  const properties = readBindingSummaryValue(input.schema, "properties");
  if (isBindingSummaryValue(properties)) {
    const propertySchema = readBindingSummaryValue(properties, input.propertyKey);
    if (isBindingSummaryValue(propertySchema)) {
      const title = readBindingSummaryValue(propertySchema, "title");
      if (typeof title === "string" && title.length > 0) {
        return title;
      }
    }
  }

  return input.propertyKey;
}

function resolveScalarSummaryValue(input: {
  schema: object;
  propertyKey: string;
  value: string | number | boolean;
}): string {
  const properties = readBindingSummaryValue(input.schema, "properties");
  if (!isBindingSummaryValue(properties)) {
    return String(input.value);
  }

  const propertySchema = readBindingSummaryValue(properties, input.propertyKey);
  if (!isBindingSummaryValue(propertySchema)) {
    return String(input.value);
  }

  const oneOfOptions = readBindingSummaryValue(propertySchema, "oneOf");
  if (!Array.isArray(oneOfOptions)) {
    return String(input.value);
  }

  for (const option of oneOfOptions) {
    if (!isBindingSummaryValue(option)) {
      continue;
    }

    const optionConst = readBindingSummaryValue(option, "const");
    const optionTitle = readBindingSummaryValue(option, "title");
    if (optionConst === input.value && typeof optionTitle === "string") {
      return optionTitle;
    }
  }

  return String(input.value);
}

export function formatSandboxProfileBindingSummaryItems(input: {
  row: SandboxProfileBindingEditorRow;
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
}): SandboxProfileBindingSummaryItem[] {
  const items: SandboxProfileBindingSummaryItem[] = [];
  const configUiModel = resolveBindingConfigUiModel({
    row: input.row,
    connections: input.availableConnections,
    targets: input.availableTargets,
  });

  if (configUiModel.mode === "form") {
    for (const propertyKey of configUiModel.visiblePropertyKeys.slice(0, 2)) {
      const value = configUiModel.value[propertyKey];
      const label = resolvePropertyTitle({
        schema: configUiModel.schema,
        uiSchema: configUiModel.uiSchema,
        propertyKey,
      });

      if (Array.isArray(value)) {
        items.push({
          label,
          value:
            value.length === 0
              ? "None"
              : value.filter((entry): entry is string => typeof entry === "string").join(", "),
        });
        continue;
      }

      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        items.push({
          label,
          value: resolveScalarSummaryValue({
            schema: configUiModel.schema,
            propertyKey,
            value,
          }),
        });
      }
    }

    return items;
  }

  if (configUiModel.mode === "no-config") {
    return [
      {
        label: "Config",
        value: "No additional config required.",
      },
    ];
  }

  if (configUiModel.mode === "unsupported") {
    return [
      {
        label: "Config",
        value: configUiModel.message,
      },
    ];
  }

  return [
    {
      label: "Config",
      value: "Connection not selected.",
    },
  ];
}
