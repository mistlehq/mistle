import { z } from "zod";

import type {
  IntegrationConfigSchema,
  IntegrationFormContext,
  IntegrationFormDefinition,
  ResolvedIntegrationForm,
} from "../types/index.js";

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneJsonValue(entry));
  }

  if (isJsonObject(value)) {
    return mergeJsonObjects({}, value);
  }

  return value;
}

function mergeJsonObjects(base: JsonObject, override: JsonObject): JsonObject {
  const merged: JsonObject = {};

  for (const [key, value] of Object.entries(base)) {
    merged[key] = cloneJsonValue(value);
  }

  for (const [key, value] of Object.entries(override)) {
    const baseValue = merged[key];
    if (isJsonObject(baseValue) && isJsonObject(value)) {
      merged[key] = mergeJsonObjects(baseValue, value);
      continue;
    }

    merged[key] = cloneJsonValue(value);
  }

  return merged;
}

function assertJsonObject(value: unknown, label: string): JsonObject {
  if (!isJsonObject(value)) {
    throw new Error(`${label} must resolve to a JSON object.`);
  }

  return value;
}

export function resolveIntegrationForm<
  TSchemaOutput,
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
  TBindingConfig = Record<string, unknown>,
  TConnectionConfig = Record<string, unknown>,
>(input: {
  schema: IntegrationConfigSchema<TSchemaOutput>;
  form?:
    | IntegrationFormDefinition<TTargetConfig, TTargetSecrets, TBindingConfig, TConnectionConfig>
    | undefined;
  context: IntegrationFormContext<TTargetConfig, TTargetSecrets, TBindingConfig, TConnectionConfig>;
}): ResolvedIntegrationForm {
  const baseSchema = assertJsonObject(z.toJSONSchema(input.schema), "Integration form schema");

  if (input.form === undefined) {
    return {
      schema: baseSchema,
    };
  }

  const resolvedForm = typeof input.form === "function" ? input.form(input.context) : input.form;
  const resolvedSchema =
    resolvedForm.schema === undefined
      ? baseSchema
      : mergeJsonObjects(baseSchema, assertJsonObject(resolvedForm.schema, "Form schema override"));

  return {
    schema: resolvedSchema,
    ...(resolvedForm.uiSchema === undefined
      ? {}
      : { uiSchema: assertJsonObject(resolvedForm.uiSchema, "Form uiSchema") }),
  };
}

export function applySchemaDefaultsToFormData(input: {
  schema: JsonObject;
  formData: Record<string, unknown>;
}): Record<string, unknown> {
  const nextFormData: Record<string, unknown> = {
    ...input.formData,
  };
  const properties = input.schema.properties;

  if (!isJsonObject(properties)) {
    return nextFormData;
  }

  for (const [propertyKey, propertySchemaValue] of Object.entries(properties)) {
    if (!isJsonObject(propertySchemaValue)) {
      continue;
    }

    const currentValue = nextFormData[propertyKey];
    const defaultValue = propertySchemaValue.default;

    if (currentValue === undefined && defaultValue !== undefined) {
      nextFormData[propertyKey] = cloneJsonValue(defaultValue);
      continue;
    }

    const oneOf = propertySchemaValue.oneOf;
    if (!Array.isArray(oneOf)) {
      continue;
    }

    const allowedValues = oneOf.flatMap((option) => {
      if (!isJsonObject(option)) {
        return [];
      }

      if ("const" in option) {
        return [option.const];
      }

      const optionEnum = option.enum;
      if (Array.isArray(optionEnum)) {
        return [...optionEnum];
      }

      return [];
    });

    if (allowedValues.some((value) => value === currentValue)) {
      continue;
    }

    if (defaultValue !== undefined) {
      nextFormData[propertyKey] = cloneJsonValue(defaultValue);
    }
  }

  return nextFormData;
}
