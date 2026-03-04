import { z } from "zod";

const BindingEditorSelectOptionSchema = z
  .object({
    value: z.string().min(1),
    label: z.string().min(1),
  })
  .strict();

const BindingEditorLiteralFieldSchema = z
  .object({
    type: z.literal("literal"),
    key: z.string().min(1),
    value: z.string().min(1),
  })
  .strict();

const BindingEditorSelectFieldSchema = z
  .object({
    type: z.literal("select"),
    key: z.string().min(1),
    label: z.string().min(1),
    options: z.array(BindingEditorSelectOptionSchema).min(1).readonly(),
    defaultValue: z.string().min(1),
    optionsByFieldValue: z
      .object({
        fieldKey: z.string().min(1),
        optionsByValue: z.record(
          z.string().min(1),
          z.array(BindingEditorSelectOptionSchema).min(1).readonly(),
        ),
        defaultValueByValue: z.record(z.string().min(1), z.string().min(1)),
      })
      .strict()
      .optional(),
  })
  .strict();

const BindingEditorStringArrayFieldSchema = z
  .object({
    type: z.literal("string-array"),
    key: z.string().min(1),
    label: z.string().min(1),
    defaultValue: z.array(z.string().min(1)).readonly(),
    delimiter: z.string().min(1),
    minItems: z.number().int().min(0).optional(),
  })
  .strict();

export const BindingEditorFieldSchema = z.discriminatedUnion("type", [
  BindingEditorLiteralFieldSchema,
  BindingEditorSelectFieldSchema,
  BindingEditorStringArrayFieldSchema,
]);

const BindingEditorVariantSchema = z
  .object({
    fields: z.array(BindingEditorFieldSchema).readonly(),
  })
  .strict();

const BindingEditorStaticConfigSchema = z
  .object({
    mode: z.literal("static"),
    variant: BindingEditorVariantSchema,
  })
  .strict();

const BindingEditorConnectionConfigKeySchema = z
  .object({
    mode: z.literal("connection-config-key"),
    key: z.string().min(1),
    variants: z.record(z.string().min(1), BindingEditorVariantSchema),
  })
  .strict();

export const IntegrationBindingEditorUiProjectionSchema = z
  .object({
    bindingEditor: z
      .object({
        kind: z.enum(["agent", "git", "connector"]),
        config: z.discriminatedUnion("mode", [
          BindingEditorStaticConfigSchema,
          BindingEditorConnectionConfigKeySchema,
        ]),
      })
      .strict(),
  })
  .strict();

export type BindingEditorField = z.output<typeof BindingEditorFieldSchema>;
export type BindingEditorVariant = z.output<typeof BindingEditorVariantSchema>;
export type IntegrationBindingEditorUiProjection = z.output<
  typeof IntegrationBindingEditorUiProjectionSchema
>;
export type BindingEditorRenderableField =
  | {
      type: "select";
      key: string;
      label: string;
      value: string;
      options: readonly { value: string; label: string }[];
    }
  | {
      type: "string-array";
      key: string;
      label: string;
      value: readonly string[];
      delimiter: string;
    };

export function parseIntegrationBindingEditorUiProjection(
  input: unknown,
): IntegrationBindingEditorUiProjection | undefined {
  const parsed = IntegrationBindingEditorUiProjectionSchema.safeParse(input);
  if (!parsed.success) {
    return undefined;
  }
  return parsed.data;
}

function readStringValue(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value !== "string") {
    return undefined;
  }

  return value;
}

function isStringArray(value: unknown): value is string[] {
  if (!Array.isArray(value)) {
    return false;
  }

  return value.every((entry) => typeof entry === "string");
}

function readStringArrayValue(
  record: Record<string, unknown>,
  key: string,
): readonly string[] | undefined {
  const value = record[key];
  if (!isStringArray(value)) {
    return undefined;
  }
  return value;
}

type BindingEditorSelectField = Extract<BindingEditorField, { type: "select" }>;

function resolveSelectOptions(input: {
  field: BindingEditorSelectField;
  config: Record<string, unknown>;
}): readonly { value: string; label: string }[] {
  if (input.field.optionsByFieldValue === undefined) {
    return input.field.options;
  }

  const parentValue = readStringValue(input.config, input.field.optionsByFieldValue.fieldKey);
  if (parentValue === undefined) {
    return [];
  }
  const options = input.field.optionsByFieldValue.optionsByValue[parentValue];
  if (options === undefined) {
    throw new Error(
      `Missing '${input.field.key}' options for '${input.field.optionsByFieldValue.fieldKey}=${parentValue}'.`,
    );
  }
  return options;
}

export function resolveBindingEditorVariant(input: {
  projection: IntegrationBindingEditorUiProjection;
  connectionConfig?: Record<string, unknown>;
}):
  | {
      ok: true;
      variant: BindingEditorVariant;
    }
  | {
      ok: false;
      message: string;
    } {
  const configModel = input.projection.bindingEditor.config;
  if (configModel.mode === "static") {
    return {
      ok: true,
      variant: configModel.variant,
    };
  }

  if (input.connectionConfig === undefined) {
    return {
      ok: false,
      message: `Connection config is required for '${configModel.mode}' binding editor mode.`,
    };
  }
  const selectedVariantKey = readStringValue(input.connectionConfig, configModel.key);
  if (selectedVariantKey === undefined) {
    return {
      ok: false,
      message: `Connection config is missing '${configModel.key}'.`,
    };
  }
  const variant = configModel.variants[selectedVariantKey];
  if (variant === undefined) {
    return {
      ok: false,
      message: `No binding editor variant for '${configModel.key}=${selectedVariantKey}'.`,
    };
  }

  return {
    ok: true,
    variant,
  };
}

export function createDefaultConfigFromBindingEditorVariant(input: {
  variant: BindingEditorVariant;
}): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const field of input.variant.fields) {
    if (field.type === "literal") {
      config[field.key] = field.value;
      continue;
    }
    if (field.type === "select") {
      if (field.optionsByFieldValue === undefined) {
        config[field.key] = field.defaultValue;
        continue;
      }

      const parentValue = readStringValue(config, field.optionsByFieldValue.fieldKey);
      if (parentValue === undefined) {
        throw new Error(
          `Default config for '${field.key}' requires '${field.optionsByFieldValue.fieldKey}'.`,
        );
      }
      const defaultValue = field.optionsByFieldValue.defaultValueByValue[parentValue];
      if (defaultValue === undefined) {
        throw new Error(
          `Missing default value for '${field.key}' when '${field.optionsByFieldValue.fieldKey}=${parentValue}'.`,
        );
      }
      config[field.key] = defaultValue;
      continue;
    }

    config[field.key] = [...field.defaultValue];
  }
  return config;
}

export function parseConfigAgainstBindingEditorVariant(input: {
  config: Record<string, unknown>;
  variant: BindingEditorVariant;
}):
  | {
      ok: true;
      value: Record<string, unknown>;
    }
  | {
      ok: false;
      message: string;
    } {
  const expectedKeys = new Set<string>(input.variant.fields.map((field) => field.key));
  for (const key of Object.keys(input.config)) {
    if (!expectedKeys.has(key)) {
      return {
        ok: false,
        message: `Binding config includes unsupported key '${key}'.`,
      };
    }
  }

  const parsed: Record<string, unknown> = {};
  for (const field of input.variant.fields) {
    if (field.type === "literal") {
      const value = readStringValue(input.config, field.key);
      if (value === undefined || value !== field.value) {
        return {
          ok: false,
          message: `Binding config has invalid value for '${field.key}'.`,
        };
      }
      parsed[field.key] = value;
      continue;
    }
    if (field.type === "select") {
      const value = readStringValue(input.config, field.key);
      if (value === undefined) {
        return {
          ok: false,
          message: `Binding config is missing '${field.key}'.`,
        };
      }
      const options = resolveSelectOptions({
        field,
        config: parsed,
      });
      if (!options.some((option) => option.value === value)) {
        return {
          ok: false,
          message: `Binding config has unsupported value for '${field.key}'.`,
        };
      }
      parsed[field.key] = value;
      continue;
    }

    const value = readStringArrayValue(input.config, field.key);
    if (value === undefined) {
      return {
        ok: false,
        message: `Binding config is missing '${field.key}'.`,
      };
    }
    parsed[field.key] = [...value];
  }

  return {
    ok: true,
    value: parsed,
  };
}

export function buildBindingEditorRenderableFields(input: {
  variant: BindingEditorVariant;
  value: Record<string, unknown>;
}): readonly BindingEditorRenderableField[] {
  const fields: BindingEditorRenderableField[] = [];
  for (const field of input.variant.fields) {
    if (field.type === "literal") {
      continue;
    }
    if (field.type === "select") {
      const value = readStringValue(input.value, field.key);
      if (value === undefined) {
        throw new Error(`Resolved binding config is missing '${field.key}'.`);
      }
      fields.push({
        type: "select",
        key: field.key,
        label: field.label,
        value,
        options: resolveSelectOptions({
          field,
          config: input.value,
        }),
      });
      continue;
    }

    const value = readStringArrayValue(input.value, field.key);
    if (value === undefined) {
      throw new Error(`Resolved binding config is missing '${field.key}'.`);
    }
    fields.push({
      type: "string-array",
      key: field.key,
      label: field.label,
      value,
      delimiter: field.delimiter,
    });
  }
  return fields;
}

export function updateBindingEditorConfigByField(input: {
  variant: BindingEditorVariant;
  currentConfig: Record<string, unknown>;
  fieldKey: string;
  nextValue: string | readonly string[];
}): Record<string, unknown> {
  const nextConfig: Record<string, unknown> = {
    ...input.currentConfig,
    [input.fieldKey]: Array.isArray(input.nextValue) ? [...input.nextValue] : input.nextValue,
  };

  for (const field of input.variant.fields) {
    if (field.type !== "select" || field.optionsByFieldValue === undefined) {
      continue;
    }
    if (field.optionsByFieldValue.fieldKey !== input.fieldKey) {
      continue;
    }

    const options = resolveSelectOptions({
      field,
      config: nextConfig,
    });
    const currentValue = readStringValue(nextConfig, field.key);
    if (currentValue !== undefined && options.some((option) => option.value === currentValue)) {
      continue;
    }

    const parentValue = readStringValue(nextConfig, field.optionsByFieldValue.fieldKey);
    if (parentValue === undefined) {
      throw new Error(`Dependent value for '${field.key}' is missing.`);
    }
    const defaultValue = field.optionsByFieldValue.defaultValueByValue[parentValue];
    if (defaultValue === undefined) {
      throw new Error(
        `Default value for '${field.key}' is missing when '${field.optionsByFieldValue.fieldKey}=${parentValue}'.`,
      );
    }
    if (!options.some((option) => option.value === defaultValue)) {
      throw new Error(
        `Default value '${defaultValue}' for '${field.key}' is not present in available options.`,
      );
    }
    nextConfig[field.key] = defaultValue;
  }

  return nextConfig;
}
