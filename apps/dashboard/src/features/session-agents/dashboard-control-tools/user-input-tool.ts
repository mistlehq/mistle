import type { CodexDynamicToolSpec } from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import { z } from "zod";

import type { ToolRequestUserInputEntry } from "../server-requests/server-request-entries.js";
import {
  DashboardControlDynamicToolNamespace,
  DesignerUserInputRequestDynamicToolName,
} from "./constants.js";
import {
  createDashboardControlDynamicToolCallResponse,
  createSuccessfulDashboardControlJsonResponse,
  type DashboardControlDynamicToolCallResponse,
} from "./responses.js";

const DesignerUserInputOptionSchema = z
  .object({
    label: z.string().min(1).max(240),
  })
  .strict();

const DesignerUserInputSaveSelectedProviderResourcesSubmitActionSchema = z
  .object({
    kind: z.literal("saveSelectedProviderResourcesToSandboxProfileDraft"),
    targetDraft: z
      .object({
        profileId: z.string().min(1).max(160),
        version: z.number().int().min(1),
      })
      .strict(),
    bindingIntent: z.string().min(1).max(160),
  })
  .strict();

const DesignerUserInputIntegrationConnectionResourceSelectionSchema = z
  .object({
    connectionId: z.string().min(1).max(160),
    resourceKind: z.string().min(1).max(120),
    resourceLabelPlural: z.string().min(1).max(80),
    searchPlaceholder: z.string().min(1).max(160).optional(),
    emptyMessage: z.string().min(1).max(240).optional(),
    initialSelectedHandles: z.array(z.string().min(1).max(500)).max(500).optional(),
  })
  .strict();

const DesignerUserInputRequestInputSchema = z
  .object({
    id: z.string().min(1).max(120),
    question: z.string().min(1).max(500),
    inputKind: z.enum(["text", "integrationConnectionResourceMultiSelect"]).optional(),
    options: z.array(DesignerUserInputOptionSchema).max(6).optional(),
    resourceSelection: DesignerUserInputIntegrationConnectionResourceSelectionSchema.optional(),
    submitAction: DesignerUserInputSaveSelectedProviderResourcesSubmitActionSchema.optional(),
  })
  .strict()
  .refine(
    (input) => {
      if (input.inputKind === "integrationConnectionResourceMultiSelect") {
        return input.resourceSelection !== undefined;
      }

      return input.options === undefined || input.options.length > 0;
    },
    {
      message: "Input kind requires a matching answer surface.",
    },
  )
  .refine(
    (input) =>
      input.inputKind !== "integrationConnectionResourceMultiSelect" || input.options === undefined,
    {
      message: "Resource selection input cannot include options.",
    },
  )
  .refine(
    (input) =>
      input.resourceSelection === undefined ||
      input.inputKind === "integrationConnectionResourceMultiSelect",
    {
      message: "Resource selection requires resource selection input kind.",
    },
  )
  .refine(
    (input) =>
      input.submitAction?.kind !== "saveSelectedProviderResourcesToSandboxProfileDraft" ||
      input.inputKind === "integrationConnectionResourceMultiSelect",
    {
      message: "Save selected provider resources submit action requires resource selection input.",
    },
  );

export const DesignerUserInputRequestDynamicToolCallSchema = z
  .object({
    namespace: z.literal(DashboardControlDynamicToolNamespace),
    tool: z.literal(DesignerUserInputRequestDynamicToolName),
    arguments: DesignerUserInputRequestInputSchema,
  })
  .loose();

export type DesignerUserInputRequestInput = z.output<typeof DesignerUserInputRequestInputSchema>;

const DesignerUserInputOptionJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    label: {
      type: "string",
      minLength: 1,
      maxLength: 240,
    },
  },
  required: ["label"],
};

const DesignerUserInputIntegrationConnectionResourceSelectionJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    connectionId: {
      type: "string",
      minLength: 1,
      maxLength: 160,
      description: "Integration connection id whose synced provider resources should be listed.",
    },
    resourceKind: {
      type: "string",
      minLength: 1,
      maxLength: 120,
      description: "Provider resource kind to select, such as repository.",
    },
    resourceLabelPlural: {
      type: "string",
      minLength: 1,
      maxLength: 80,
      description: "Plural user-facing label for this resource kind, such as repositories.",
    },
    searchPlaceholder: {
      type: "string",
      minLength: 1,
      maxLength: 160,
    },
    emptyMessage: {
      type: "string",
      minLength: 1,
      maxLength: 240,
    },
    initialSelectedHandles: {
      type: "array",
      items: {
        type: "string",
        minLength: 1,
        maxLength: 500,
      },
      maxItems: 500,
    },
  },
  required: ["connectionId", "resourceKind", "resourceLabelPlural"],
};

const DesignerUserInputSubmitActionJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: {
      type: "string",
      enum: ["saveSelectedProviderResourcesToSandboxProfileDraft"],
    },
    targetDraft: {
      type: "object",
      additionalProperties: false,
      properties: {
        profileId: {
          type: "string",
          minLength: 1,
          maxLength: 160,
          description: "Sandbox profile draft id to update, such as sbp_...",
        },
        version: {
          type: "integer",
          minimum: 1,
        },
      },
      required: ["profileId", "version"],
    },
    bindingIntent: {
      type: "string",
      minLength: 1,
      maxLength: 160,
      description:
        "Provider resource binding intent id exposed by the selected integration capability, such as git-repositories.",
    },
  },
  required: ["kind", "targetDraft", "bindingIntent"],
};

export const DesignerUserInputRequestDynamicToolSpec = {
  namespace: DashboardControlDynamicToolNamespace,
  name: DesignerUserInputRequestDynamicToolName,
  description:
    "Present exactly one dashboard decision request and wait for the user's response. Use this for a concrete next action, setup-completion check, configuration answer, or integration resource selection.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      id: {
        type: "string",
        minLength: 1,
        maxLength: 120,
        description: "Stable answer id for this one question.",
      },
      question: {
        type: "string",
        minLength: 1,
        maxLength: 500,
      },
      inputKind: {
        type: "string",
        enum: ["text", "integrationConnectionResourceMultiSelect"],
        description:
          "Omit or use text for option questions. Use integrationConnectionResourceMultiSelect to let the dashboard list and select provider resources from an integration connection.",
      },
      options: {
        type: "array",
        items: DesignerUserInputOptionJsonSchema,
        minItems: 1,
        maxItems: 6,
        description:
          "Short selectable answer labels for an option question. Put the recommended option first when there is one.",
      },
      resourceSelection: DesignerUserInputIntegrationConnectionResourceSelectionJsonSchema,
      submitAction: DesignerUserInputSubmitActionJsonSchema,
    },
    required: ["id", "question"],
    allOf: [
      {
        if: {
          properties: {
            inputKind: {
              const: "integrationConnectionResourceMultiSelect",
            },
          },
          required: ["inputKind"],
        },
        then: {
          required: ["resourceSelection"],
        },
      },
      {
        if: {
          required: ["resourceSelection"],
        },
        then: {
          properties: {
            inputKind: {
              const: "integrationConnectionResourceMultiSelect",
            },
          },
          required: ["inputKind"],
        },
      },
      {
        if: {
          properties: {
            submitAction: {
              properties: {
                kind: {
                  const: "saveSelectedProviderResourcesToSandboxProfileDraft",
                },
              },
              required: ["kind"],
            },
          },
          required: ["submitAction"],
        },
        then: {
          properties: {
            inputKind: {
              const: "integrationConnectionResourceMultiSelect",
            },
          },
          required: ["inputKind", "resourceSelection"],
        },
      },
    ],
  },
} satisfies CodexDynamicToolSpec;

export function createDashboardControlUserInputServerRequest(input: {
  requestId: string | number;
  userInput: DesignerUserInputRequestInput;
}): ToolRequestUserInputEntry {
  return {
    requestId: input.requestId,
    method: "tool/requestUserInput",
    kind: "tool-user-input",
    questions: [
      {
        header: null,
        id: input.userInput.id,
        ...(input.userInput.inputKind === undefined
          ? {}
          : { inputKind: input.userInput.inputKind }),
        question: input.userInput.question,
        ...(input.userInput.resourceSelection === undefined
          ? {}
          : {
              resourceSelection: {
                connectionId: input.userInput.resourceSelection.connectionId,
                resourceKind: input.userInput.resourceSelection.resourceKind,
                resourceLabelPlural: input.userInput.resourceSelection.resourceLabelPlural,
                ...(input.userInput.resourceSelection.searchPlaceholder === undefined
                  ? {}
                  : { searchPlaceholder: input.userInput.resourceSelection.searchPlaceholder }),
                ...(input.userInput.resourceSelection.emptyMessage === undefined
                  ? {}
                  : { emptyMessage: input.userInput.resourceSelection.emptyMessage }),
                ...(input.userInput.resourceSelection.initialSelectedHandles === undefined
                  ? {}
                  : {
                      initialSelectedHandles: [
                        ...input.userInput.resourceSelection.initialSelectedHandles,
                      ],
                    }),
              },
            }),
        ...(input.userInput.submitAction === undefined
          ? {}
          : { submitAction: input.userInput.submitAction }),
        ...(input.userInput.inputKind === "integrationConnectionResourceMultiSelect"
          ? {}
          : {
              options: [
                ...(input.userInput.options ?? []).map((option) => ({
                  label: option.label,
                  isOther: false,
                })),
              ],
            }),
      },
    ],
    status: "pending",
    responseErrorMessage: null,
  };
}

export function createDashboardControlUserInputResponse(input: {
  result: unknown;
}): DashboardControlDynamicToolCallResponse {
  const customResponse = z
    .object({
      customResponse: z
        .object({
          text: z.string().min(1),
        })
        .strict(),
    })
    .strict()
    .safeParse(input.result);

  if (customResponse.success) {
    return createSuccessfulDashboardControlJsonResponse({
      customResponse: customResponse.data.customResponse,
    });
  }

  const parsed = z
    .object({
      answers: z
        .array(
          z.object({
            id: z.string().min(1),
            value: z.union([z.string(), z.array(z.string())]),
            sideEffect: z
              .object({
                kind: z.literal("sandbox-profile-draft-provider-resources-saved"),
                profileId: z.string().min(1),
                version: z.number().int().min(1),
                connectionId: z.string().min(1),
                resourceKind: z.string().min(1),
                bindingIntent: z.string().min(1),
                bindingId: z.string().min(1),
                selectedHandles: z.array(z.string().min(1)),
                createdBinding: z.boolean(),
              })
              .optional(),
          }),
        )
        .min(1),
    })
    .safeParse(input.result);

  if (!parsed.success) {
    return createDashboardControlDynamicToolCallResponse({
      success: false,
      text: "Designer user input response was invalid.",
    });
  }

  return createSuccessfulDashboardControlJsonResponse({
    answers: parsed.data.answers,
  });
}
