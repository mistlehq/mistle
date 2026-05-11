import { z } from "zod";

import type {
  IntegrationConnectionMethodDetailFieldSource,
  IntegrationConnectionMethodDetailMetadata,
  IntegrationFormConnectionMethodPostCreateMetadata,
  IntegrationFormConnectionMethodSetupCompletionRequirement,
  IntegrationFormConnectionMethodSetupFlowMetadata,
} from "../types/index.js";

const IntegrationConnectionMethodDetailFieldSourceLeafSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("config-field"),
      field: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("connection-external-subject"),
    })
    .strict(),
]);

export const IntegrationConnectionMethodDetailFieldSourceSchema: z.ZodType<IntegrationConnectionMethodDetailFieldSource> =
  z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("config-field"),
        field: z.string().min(1),
      })
      .strict(),
    z
      .object({
        kind: z.literal("connection-external-subject"),
      })
      .strict(),
    z
      .object({
        kind: z.literal("first-of"),
        sources: z.array(IntegrationConnectionMethodDetailFieldSourceLeafSchema).min(1),
      })
      .strict(),
  ]);

export const IntegrationConnectionMethodDetailMetadataSchema: z.ZodType<IntegrationConnectionMethodDetailMetadata> =
  z
    .object({
      installation: z
        .object({
          actionLabel: z.string().min(1).optional(),
          fields: z
            .array(
              z
                .object({
                  label: z.string().min(1),
                  required: z.boolean().optional(),
                  source: IntegrationConnectionMethodDetailFieldSourceSchema,
                })
                .strict(),
            )
            .min(1)
            .optional(),
          hideWebhookSourceSection: z.boolean().optional(),
          includeWebhookCallbackUrl: z.boolean().optional(),
          postInstallationSetupPath: z.string().min(1).optional(),
        })
        .strict()
        .optional(),
    })
    .strict();

export const IntegrationFormConnectionMethodPostCreateMetadataSchema: z.ZodType<IntegrationFormConnectionMethodPostCreateMetadata> =
  z
    .object({
      managedWebhookSource: z
        .object({
          autoCreate: z.boolean().optional(),
          failureNoticeTitle: z.string().min(1),
          successNoticeTitle: z.string().min(1),
        })
        .strict()
        .optional(),
    })
    .strict();

const IntegrationSetupConnectionExternalSubjectRequirementSchema = z
  .object({
    kind: z.literal("connection-external-subject"),
  })
  .strict();

const IntegrationSetupConfigFieldRequirementSchema = z
  .object({
    kind: z.literal("config-field"),
    field: z.string().min(1),
  })
  .strict();

const IntegrationSetupSecretFieldRequirementSchema = z
  .object({
    kind: z.literal("secret-field"),
    field: z.string().min(1),
  })
  .strict();

const IntegrationSetupCompletionRequirementLeafSchema = z.discriminatedUnion("kind", [
  IntegrationSetupConnectionExternalSubjectRequirementSchema,
  IntegrationSetupConfigFieldRequirementSchema,
  IntegrationSetupSecretFieldRequirementSchema,
]);

export const IntegrationSetupCompletionRequirementSchema: z.ZodType<IntegrationFormConnectionMethodSetupCompletionRequirement> =
  z.discriminatedUnion("kind", [
    IntegrationSetupConnectionExternalSubjectRequirementSchema,
    IntegrationSetupConfigFieldRequirementSchema,
    IntegrationSetupSecretFieldRequirementSchema,
    z
      .object({
        kind: z.literal("any-of"),
        anyOf: z.array(IntegrationSetupCompletionRequirementLeafSchema).min(1),
      })
      .strict(),
    z
      .object({
        kind: z.literal("all-of"),
        allOf: z.array(IntegrationSetupCompletionRequirementLeafSchema).min(1),
      })
      .strict(),
  ]);

const IntegrationFormConnectionMethodSetupStartFormActionSchema = z
  .object({
    href: z.url(),
    label: z.string().min(1),
    opensInNewWindow: z.boolean().optional(),
  })
  .strict();

const IntegrationFormConnectionMethodSetupStartFormFieldSchema = z
  .object({
    actions: z.array(IntegrationFormConnectionMethodSetupStartFormActionSchema).min(1).optional(),
    description: z.string().min(1).optional(),
    inputType: z.enum(["password", "radio", "text", "textarea"]),
    label: z.string().min(1),
    name: z.string().min(1),
    options: z
      .array(
        z
          .object({
            label: z.string().min(1),
            value: z.string().min(1),
          })
          .strict(),
      )
      .min(1)
      .optional(),
    placeholder: z.string().min(1).optional(),
    required: z.boolean().optional(),
    visibleWhen: z
      .object({
        field: z.string().min(1),
        value: z.string().min(1),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((field, context) => {
    if (field.inputType === "radio" && field.options === undefined) {
      context.addIssue({
        code: "custom",
        message: `Setup start form radio field '${field.name}' must define options.`,
        path: ["options"],
      });
    }
  });

const IntegrationFormConnectionMethodSetupStartFormSchema = z
  .object({
    fields: z.array(IntegrationFormConnectionMethodSetupStartFormFieldSchema).min(1),
    submitLabel: z.string().min(1),
  })
  .strict();

const IntegrationFormConnectionMethodSetupPaneMetadataSchema = z
  .object({
    kind: z.literal("provider-app"),
  })
  .strict();

const IntegrationFormConnectionMethodProviderAppSetupSchema = z
  .object({
    description: z.string().min(1),
    existingApp: z
      .object({
        configFields: z
          .array(
            z
              .object({
                configKey: z.string().min(1),
                label: z.string().min(1),
                name: z.string().min(1),
                required: z.boolean(),
              })
              .strict(),
          )
          .min(1),
        connectLabel: z.string().min(1),
        description: z.string().min(1),
        installedDetection: z
          .object({
            configFields: z.array(z.string().min(1)),
            secretFields: z.array(z.string().min(1)),
          })
          .strict(),
        saveErrorMessage: z.string().min(1),
        secretFields: z
          .array(
            z
              .object({
                inputType: z.enum(["password", "textarea"]),
                label: z.string().min(1),
                name: z.string().min(1),
                placeholder: z.string().min(1).optional(),
                rows: z.number().int().min(1).optional(),
                required: z.boolean(),
                secretLabel: z.string().min(1),
              })
              .strict(),
          )
          .min(1),
        startAction: z
          .object({
            expectedResultKind: z.literal("redirect"),
            installedDetection: z
              .object({
                configFields: z.array(z.string().min(1)).optional(),
                externalSubject: z.boolean().optional(),
              })
              .strict()
              .optional(),
            installedLabel: z.string().min(1),
            installedOpensInNewWindow: z.boolean().optional(),
            pendingLabel: z.string().min(1).optional(),
            routeSegment: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
            startErrorMessage: z.string().min(1),
            unexpectedResultMessage: z.string().min(1),
            windowTitle: z.string().min(1),
          })
          .strict()
          .optional(),
        title: z.string().min(1),
      })
      .strict(),
    manifest: z
      .object({
        createErrorMessage: z.string().min(1),
        description: z.string().min(1),
        startAction: z
          .object({
            expectedResultKind: z.enum(["form-post", "redirect"]),
            manifestBodyField: z.string().min(1),
            unexpectedResultMessage: z.string().min(1),
          })
          .strict(),
        title: z.string().min(1),
      })
      .strict(),
    title: z.string().min(1),
    urls: z
      .object({
        description: z.string().min(1),
        setupCallback: z
          .object({
            label: z.string().min(1),
            path: z.string().regex(/^\/[^\s]*$/),
          })
          .strict()
          .optional(),
        title: z.string().min(1),
        webhookCallback: z
          .object({
            errorTitle: z.string().min(1),
            label: z.string().min(1),
            missingMessage: z.string().min(1),
            missingTitle: z.string().min(1),
          })
          .strict(),
      })
      .strict(),
  })
  .strict()
  .superRefine((providerAppSetup, context) => {
    const configFieldNames = new Set(
      providerAppSetup.existingApp.configFields.map((field) => field.name),
    );
    const secretFieldNames = new Set(
      providerAppSetup.existingApp.secretFields.map((field) => field.name),
    );

    for (const fieldName of providerAppSetup.existingApp.installedDetection.configFields) {
      if (!configFieldNames.has(fieldName)) {
        context.addIssue({
          code: "custom",
          message: `Installed detection config field '${fieldName}' is not declared in existing app config fields.`,
          path: ["existingApp", "installedDetection", "configFields"],
        });
      }
    }

    for (const fieldName of providerAppSetup.existingApp.installedDetection.secretFields) {
      if (!secretFieldNames.has(fieldName)) {
        context.addIssue({
          code: "custom",
          message: `Installed detection secret field '${fieldName}' is not declared in existing app secret fields.`,
          path: ["existingApp", "installedDetection", "secretFields"],
        });
      }
    }
  });

export const IntegrationFormConnectionMethodSetupFlowMetadataSchema: z.ZodType<IntegrationFormConnectionMethodSetupFlowMetadata> =
  z
    .object({
      completionRequirements: IntegrationSetupCompletionRequirementSchema.optional(),
      providerAppSetup: IntegrationFormConnectionMethodProviderAppSetupSchema.optional(),
      routeSegment: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
      setupPane: IntegrationFormConnectionMethodSetupPaneMetadataSchema.optional(),
      startForm: IntegrationFormConnectionMethodSetupStartFormSchema.optional(),
    })
    .strict();
