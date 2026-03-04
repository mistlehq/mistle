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

export function parseIntegrationBindingEditorUiProjection(
  input: unknown,
): IntegrationBindingEditorUiProjection | undefined {
  const parsed = IntegrationBindingEditorUiProjectionSchema.safeParse(input);
  if (!parsed.success) {
    return undefined;
  }
  return parsed.data;
}
