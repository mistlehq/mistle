import { isRecord } from "../shared/is-record.js";
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

function resolvePropertyTitle(input: {
  schema: Record<string, unknown>;
  uiSchema: Record<string, unknown>;
  propertyKey: string;
}): string {
  const propertyUiSchema = input.uiSchema[input.propertyKey];
  if (isRecord(propertyUiSchema)) {
    const uiTitle = propertyUiSchema["ui:title"];
    if (typeof uiTitle === "string" && uiTitle.length > 0) {
      return uiTitle;
    }
  }

  const properties = input.schema.properties;
  if (isRecord(properties)) {
    const propertySchema = properties[input.propertyKey];
    if (isRecord(propertySchema)) {
      const title = propertySchema.title;
      if (typeof title === "string" && title.length > 0) {
        return title;
      }
    }
  }

  return input.propertyKey;
}

function resolveScalarSummaryValue(input: {
  schema: Record<string, unknown>;
  propertyKey: string;
  value: string | number | boolean;
}): string {
  const properties = input.schema.properties;
  if (!isRecord(properties)) {
    return String(input.value);
  }

  const propertySchema = properties[input.propertyKey];
  if (!isRecord(propertySchema) || !Array.isArray(propertySchema.oneOf)) {
    return String(input.value);
  }

  for (const option of propertySchema.oneOf) {
    if (!isRecord(option)) {
      continue;
    }

    if (option.const === input.value && typeof option.title === "string") {
      return option.title;
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
