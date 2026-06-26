import type { CodexDynamicToolSpec } from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import type { CodexJsonRpcServerRequest } from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import { z } from "zod";

import {
  DesignerBlueprintCurrentTabHref,
  DesignerBlueprintCurrentTabId,
  DesignerBlueprintDocumentSchema,
} from "../designer/designer-blueprint-schema.js";
import type { ToolRequestUserInputEntry } from "./server-requests/server-request-entries.js";

export const DesignerCanvasTabOpenAction = "designerCanvas.tabOpen";
export const DesignerBlueprintTabUpsertAction = "designerBlueprint.tabUpsert";
export const DesignerUserInputRequestAction = "designerUserInput.request";
export const DashboardControlDynamicToolRequestMethod = "item/tool/call";
export const DashboardControlDynamicToolNamespace = "dashboard_control";
export const DesignerCanvasTabShowDynamicToolName = "show_designer_canvas_tab";
export const DesignerUserInputRequestDynamicToolName = "request_user_input";

const DesignerCanvasRouteTabShowInputSchema = z
  .object({
    kind: z.literal("route"),
    id: z
      .string()
      .min(1)
      .max(128)
      .refine((id) => id !== DesignerBlueprintCurrentTabId, {
        message: "id is reserved for the Designer blueprint tab.",
      }),
    title: z.string().min(1).max(120),
    href: z
      .string()
      .min(1)
      .max(2_048)
      .refine((href) => isDashboardInternalAbsolutePath(href), {
        message: "href must be a dashboard-internal absolute path.",
      })
      .refine((href) => href !== DesignerBlueprintCurrentTabHref, {
        message: "href is reserved for the Designer blueprint tab.",
      }),
  })
  .strict();

const DesignerBlueprintTabShowInputSchema = z
  .object({
    kind: z.literal("blueprint"),
    title: z.string().min(1).max(120),
    blueprint: DesignerBlueprintDocumentSchema,
  })
  .strict();

const DesignerCanvasTabShowInputSchema = z
  .object({
    tab: z.discriminatedUnion("kind", [
      DesignerCanvasRouteTabShowInputSchema,
      DesignerBlueprintTabShowInputSchema,
    ]),
  })
  .strict();

const DesignerCanvasTabShowDynamicToolCallSchema = z
  .object({
    namespace: z.literal(DashboardControlDynamicToolNamespace),
    tool: z.literal(DesignerCanvasTabShowDynamicToolName),
    arguments: DesignerCanvasTabShowInputSchema,
  })
  .loose();

const DesignerUserInputOptionSchema = z
  .object({
    label: z.string().min(1).max(240),
  })
  .strict();

const DesignerUserInputFreeFormSchema = z
  .object({
    label: z.string().min(1).max(160),
    defaultValue: z.string().max(4000).optional(),
    inputKind: z.enum(["input", "textarea"]).optional(),
  })
  .strict();

const DesignerUserInputAnswerOnlySubmitBehaviorSchema = z
  .object({
    kind: z.literal("answerOnly"),
  })
  .strict();

const DesignerUserInputSaveSandboxProfileDraftBindingSubmitBehaviorSchema = z
  .object({
    kind: z.literal("saveSandboxProfileDraftBinding"),
    profileId: z.string().min(1).max(160),
    version: z.number().int().min(1),
    bindingId: z.string().min(1).max(160),
    configField: z.string().min(1).max(120),
  })
  .strict();

const DesignerUserInputSubmitBehaviorSchema = z.discriminatedUnion("kind", [
  DesignerUserInputAnswerOnlySubmitBehaviorSchema,
  DesignerUserInputSaveSandboxProfileDraftBindingSubmitBehaviorSchema,
]);

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
    header: z.string().min(1).max(80).optional(),
    id: z.string().min(1).max(120),
    question: z.string().min(1).max(500),
    inputKind: z.enum(["text", "integrationConnectionResourceMultiSelect"]).optional(),
    options: z.array(DesignerUserInputOptionSchema).max(6).optional(),
    freeForm: DesignerUserInputFreeFormSchema.optional(),
    resourceSelection: DesignerUserInputIntegrationConnectionResourceSelectionSchema.optional(),
    submitBehavior: DesignerUserInputSubmitBehaviorSchema.optional(),
  })
  .strict()
  .refine(
    (input) => {
      if (input.inputKind === "integrationConnectionResourceMultiSelect") {
        return input.resourceSelection !== undefined;
      }

      return (
        (input.options !== undefined && input.options.length > 0) || input.freeForm !== undefined
      );
    },
    {
      message: "Input kind requires a matching answer surface.",
    },
  )
  .refine(
    (input) =>
      input.inputKind !== "integrationConnectionResourceMultiSelect" ||
      (input.options === undefined && input.freeForm === undefined),
    {
      message: "Resource selection input cannot include options or freeForm.",
    },
  )
  .refine(
    (input) =>
      input.submitBehavior?.kind !== "saveSandboxProfileDraftBinding" ||
      input.inputKind === "integrationConnectionResourceMultiSelect",
    {
      message: "Save draft submit behavior requires resource selection input.",
    },
  );

const DesignerUserInputRequestDynamicToolCallSchema = z
  .object({
    namespace: z.literal(DashboardControlDynamicToolNamespace),
    tool: z.literal(DesignerUserInputRequestDynamicToolName),
    arguments: DesignerUserInputRequestInputSchema,
  })
  .loose();

const DashboardControlDynamicToolCallIdentitySchema = z
  .object({
    namespace: z.string().nullable().optional(),
    tool: z.string().optional(),
  })
  .loose();

const DashboardControlDynamicToolInputSchema = z
  .object({
    contentItems: z.array(
      z.object({
        type: z.literal("inputText"),
        text: z.string(),
      }),
    ),
    success: z.boolean(),
  })
  .strict();

export type DesignerCanvasRouteTabShowInput = z.output<
  typeof DesignerCanvasRouteTabShowInputSchema
>;
export type DesignerBlueprintTabShowInput = z.output<typeof DesignerBlueprintTabShowInputSchema>;
export type DesignerUserInputRequestInput = z.output<typeof DesignerUserInputRequestInputSchema>;
export type DashboardControlDynamicToolCallResponse = z.output<
  typeof DashboardControlDynamicToolInputSchema
>;

export type DashboardControlActionRequest =
  | {
      action: typeof DesignerCanvasTabOpenAction;
      input: DesignerCanvasRouteTabShowInput;
    }
  | {
      action: typeof DesignerBlueprintTabUpsertAction;
      input: DesignerBlueprintTabShowInput;
    }
  | {
      action: typeof DesignerUserInputRequestAction;
      input: DesignerUserInputRequestInput;
    };

export type DashboardControlCanvasActionRequest = Exclude<
  DashboardControlActionRequest,
  { action: typeof DesignerUserInputRequestAction }
>;

export type DashboardControlActionHandler = (
  request: DashboardControlCanvasActionRequest,
) => Promise<void>;

export type DashboardControlActionSupport = {
  supportedActions: readonly string[];
  handleAction: DashboardControlActionHandler;
  userInputSubmitBehavior?: {
    sandboxProfileDraftBinding?: {
      profileId: string;
      version: number;
    };
  };
};

const DesignerBlueprintConditionValueJsonSchema = {
  anyOf: [
    { type: "string" },
    {
      type: "array",
      items: {
        type: "string",
        minLength: 1,
      },
      minItems: 1,
      maxItems: 50,
    },
    { type: "number" },
    { type: "boolean" },
  ],
};

const DesignerBlueprintRoutingConditionJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    field: {
      type: "string",
      minLength: 1,
      maxLength: 128,
    },
    operator: {
      type: "string",
      enum: ["equals", "not_equals", "includes", "excludes", "in", "empty", "not_empty"],
    },
    value: DesignerBlueprintConditionValueJsonSchema,
  },
  required: ["field", "operator"],
};

const DesignerBlueprintRoutingRuleJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    label: {
      type: "string",
      minLength: 1,
      maxLength: 160,
    },
    when: {
      type: "array",
      items: DesignerBlueprintRoutingConditionJsonSchema,
      minItems: 1,
      maxItems: 20,
      description: "Conjunctive conditions. Every condition in this array must match.",
    },
    routeTo: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      description: "Optional item id to route to. Must reference an item in blueprint.items.",
    },
  },
  required: ["when"],
};

const DesignerBlueprintCommonItemJsonSchemaProperties = {
  id: {
    type: "string",
    minLength: 1,
    maxLength: 128,
    description: "Stable item id. Must be unique within blueprint.items.",
  },
  label: {
    type: "string",
    minLength: 1,
    maxLength: 160,
  },
  description: {
    type: "string",
    minLength: 1,
    maxLength: 2000,
  },
  parentId: {
    type: "string",
    minLength: 1,
    maxLength: 128,
    description: "Optional parent item id for sub-workflow/detail items.",
  },
  state: {
    type: "string",
    enum: ["proposed", "needs_setup", "ready_to_confirm", "applied", "blocked"],
  },
};

const DesignerBlueprintStandardItemJsonSchema = {
  type: "object",
  additionalProperties: false,
  description:
    "Workflow item. Use agent_step for agent work and workflow_output for visible workflow results.",
  properties: {
    ...DesignerBlueprintCommonItemJsonSchemaProperties,
    kind: {
      type: "string",
      enum: ["agent_step", "workflow_output"],
    },
  },
  required: ["id", "kind", "label", "state"],
};

const DesignerBlueprintTriggerItemJsonSchema = {
  type: "object",
  additionalProperties: false,
  description:
    "Workflow-start trigger item. Use this for provider, schedule, or system events that start or advance the workflow; include integrationTargetKey when a real Mistle integration target is selected or known, and include integrationLabel and eventLabel when known.",
  properties: {
    ...DesignerBlueprintCommonItemJsonSchemaProperties,
    kind: {
      type: "string",
      enum: ["trigger"],
    },
    integrationTargetKey: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      description:
        "Stable Mistle integration target key, such as slack-default or github-cloud. Use only when the trigger source maps to a selected or known integration target.",
    },
    integrationLabel: {
      type: "string",
      minLength: 1,
      maxLength: 80,
      description: "Provider or integration label shown on the trigger, such as GitHub or Slack.",
    },
    eventLabel: {
      type: "string",
      minLength: 1,
      maxLength: 160,
      description: "Specific event shown on the trigger, such as PR opened or message received.",
    },
  },
  required: ["id", "kind", "label", "state"],
};

const DesignerBlueprintRoutingPolicyItemJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    ...DesignerBlueprintCommonItemJsonSchemaProperties,
    kind: {
      type: "string",
      enum: ["routing_policy"],
    },
    rules: {
      type: "array",
      items: DesignerBlueprintRoutingRuleJsonSchema,
      minItems: 1,
      maxItems: 20,
    },
  },
  required: ["id", "kind", "label", "state", "rules"],
};

const DesignerBlueprintDocumentJsonSchema = {
  type: "object",
  additionalProperties: false,
  description:
    "Workflow visualization. Model what happens using trigger nodes, agent steps, routing policies, and outputs. Links, actions, and routing rule targets must reference item ids; the top-level outcome is not an item id.",
  properties: {
    version: {
      type: "number",
      enum: [1],
    },
    title: {
      type: "string",
      minLength: 1,
      maxLength: 160,
    },
    outcome: {
      type: "object",
      additionalProperties: false,
      properties: {
        label: {
          type: "string",
          minLength: 1,
          maxLength: 160,
        },
        description: {
          type: "string",
          minLength: 1,
          maxLength: 2000,
        },
      },
      required: ["label"],
    },
    items: {
      type: "array",
      items: {
        oneOf: [
          DesignerBlueprintStandardItemJsonSchema,
          DesignerBlueprintTriggerItemJsonSchema,
          DesignerBlueprintRoutingPolicyItemJsonSchema,
        ],
      },
      maxItems: 100,
      description: "Semantic solution items. Item ids must be unique.",
    },
    links: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          from: {
            type: "string",
            minLength: 1,
            maxLength: 128,
            description: "Source item id. Must reference an item in blueprint.items.",
          },
          to: {
            type: "string",
            minLength: 1,
            maxLength: 128,
            description: "Target item id. Must reference an item in blueprint.items.",
          },
          kind: {
            type: "string",
            enum: [
              "requires",
              "triggers",
              "configures",
              "produces",
              "confirms",
              "routes_to",
              "hands_off_to",
              "uses",
            ],
          },
        },
        required: ["from", "to", "kind"],
      },
      maxItems: 200,
    },
    actions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: {
            type: "string",
            minLength: 1,
            maxLength: 128,
          },
          itemId: {
            type: "string",
            minLength: 1,
            maxLength: 128,
            description:
              "Item id this action belongs to. Must reference an item in blueprint.items.",
          },
          kind: {
            type: "string",
            enum: [
              "open_integration_setup",
              "open_trigger_create",
              "open_trigger_edit",
              "open_sandbox_profile",
              "open_sandbox_profile_section",
            ],
          },
          label: {
            type: "string",
            minLength: 1,
            maxLength: 160,
          },
          href: {
            type: "string",
            minLength: 1,
            maxLength: 2048,
            description: "Dashboard-internal absolute path such as /integrations/linear.",
          },
        },
        required: ["id", "itemId", "kind", "label", "href"],
      },
      maxItems: 50,
    },
  },
  required: ["version", "title", "outcome", "items", "links", "actions"],
};

const DesignerCanvasRouteTabJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: {
      type: "string",
      enum: ["route"],
    },
    id: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      description:
        "Stable tab id for this dashboard route. Do not use designer-blueprint-current; that id is reserved for blueprint tabs.",
    },
    title: {
      type: "string",
      minLength: 1,
      maxLength: 120,
    },
    href: {
      type: "string",
      minLength: 1,
      maxLength: 2048,
      description:
        "Dashboard-internal absolute path. Do not use /designer/blueprints/current; that href is reserved for blueprint tabs.",
    },
  },
  required: ["kind", "id", "title", "href"],
};

const DesignerCanvasBlueprintTabJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: {
      type: "string",
      enum: ["blueprint"],
    },
    title: {
      type: "string",
      minLength: 1,
      maxLength: 120,
    },
    blueprint: {
      ...DesignerBlueprintDocumentJsonSchema,
      description:
        "Designer blueprint document. Must use version 1, fit within 64 KB, and describe semantic workflow structure. The dashboard assigns the stable blueprint tab id and href.",
    },
  },
  required: ["kind", "title", "blueprint"],
};

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

const DesignerUserInputFreeFormJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    label: {
      type: "string",
      minLength: 1,
      maxLength: 160,
      description: "Placeholder label for the free-form response.",
    },
    defaultValue: {
      type: "string",
      maxLength: 4000,
    },
    inputKind: {
      type: "string",
      enum: ["input", "textarea"],
      description: "Use textarea only when the user needs to edit multi-line text.",
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

const DesignerUserInputSubmitBehaviorJsonSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: {
          type: "string",
          enum: ["answerOnly"],
        },
      },
      required: ["kind"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: {
          type: "string",
          enum: ["saveSandboxProfileDraftBinding"],
        },
        profileId: {
          type: "string",
          minLength: 1,
          maxLength: 160,
        },
        version: {
          type: "integer",
          minimum: 1,
        },
        bindingId: {
          type: "string",
          minLength: 1,
          maxLength: 160,
        },
        configField: {
          type: "string",
          minLength: 1,
          maxLength: 120,
          description:
            "Top-level binding config field to replace with the selected resource handles.",
        },
      },
      required: ["kind", "profileId", "version", "bindingId", "configField"],
    },
  ],
};

export const DesignerCanvasTabShowDynamicToolSpec = {
  namespace: DashboardControlDynamicToolNamespace,
  name: DesignerCanvasTabShowDynamicToolName,
  description:
    "Show a route or blueprint in the Designer canvas. The dashboard creates, replaces, or focuses the matching tab.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      tab: {
        oneOf: [DesignerCanvasRouteTabJsonSchema, DesignerCanvasBlueprintTabJsonSchema],
      },
    },
    required: ["tab"],
  },
} satisfies CodexDynamicToolSpec;

export const DesignerUserInputRequestDynamicToolSpec = {
  namespace: DashboardControlDynamicToolNamespace,
  name: DesignerUserInputRequestDynamicToolName,
  description:
    "Ask the user exactly one setup question in the dashboard. Use this for Designer decisions that need a selectable choice, short free-form response, or integration connection resource selection.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      header: {
        type: "string",
        minLength: 1,
        maxLength: 80,
        description: "Short label for the decision, such as Suggested next actions.",
      },
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
          "Omit or use text for options/freeForm questions. Use integrationConnectionResourceMultiSelect to let the dashboard list and select provider resources from an integration connection.",
      },
      options: {
        type: "array",
        items: DesignerUserInputOptionJsonSchema,
        minItems: 1,
        maxItems: 6,
        description:
          "Selectable options. Include the recommended option first when there is a recommendation. Keep option labels short and clear.",
      },
      freeForm: DesignerUserInputFreeFormJsonSchema,
      resourceSelection: DesignerUserInputIntegrationConnectionResourceSelectionJsonSchema,
      submitBehavior: DesignerUserInputSubmitBehaviorJsonSchema,
    },
    required: ["id", "question"],
    anyOf: [
      { required: ["options"] },
      { required: ["freeForm"] },
      {
        properties: {
          inputKind: {
            const: "integrationConnectionResourceMultiSelect",
          },
        },
        required: ["inputKind", "resourceSelection"],
      },
    ],
    allOf: [
      {
        if: {
          properties: {
            submitBehavior: {
              properties: {
                kind: {
                  const: "saveSandboxProfileDraftBinding",
                },
              },
              required: ["kind"],
            },
          },
          required: ["submitBehavior"],
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

export const DashboardControlDynamicToolSpecs = [
  DesignerCanvasTabShowDynamicToolSpec,
  DesignerUserInputRequestDynamicToolSpec,
] satisfies readonly CodexDynamicToolSpec[];

function isKnownDashboardControlDynamicToolName(toolName: string | undefined): boolean {
  return (
    toolName === DesignerCanvasTabShowDynamicToolName ||
    toolName === DesignerUserInputRequestDynamicToolName
  );
}

function createDashboardControlFreeFormUserInputOption(
  freeForm: DesignerUserInputRequestInput["freeForm"],
): NonNullable<ToolRequestUserInputEntry["questions"][number]["options"]>[number] | null {
  if (freeForm === undefined) {
    return null;
  }

  if (freeForm.inputKind === "textarea") {
    return {
      label: freeForm.label,
      defaultValue: freeForm.defaultValue ?? null,
      inputKind: "textarea",
      isOther: true,
    };
  }

  return {
    label: freeForm.label,
    defaultValue: freeForm.defaultValue ?? null,
    isOther: true,
  };
}

export function isDashboardControlDynamicToolCallRequest(
  request: CodexJsonRpcServerRequest,
): request is CodexJsonRpcServerRequest & {
  method: typeof DashboardControlDynamicToolRequestMethod;
} {
  if (request.method !== DashboardControlDynamicToolRequestMethod) {
    return false;
  }

  const identity = DashboardControlDynamicToolCallIdentitySchema.safeParse(request.params);
  return (
    identity.success &&
    identity.data.namespace === DashboardControlDynamicToolNamespace &&
    isKnownDashboardControlDynamicToolName(identity.data.tool)
  );
}

export function parseDashboardControlDynamicToolCall(
  params: unknown,
): DashboardControlActionRequest | DashboardControlDynamicToolCallResponse {
  const parsedCanvasTabRequest = DesignerCanvasTabShowDynamicToolCallSchema.safeParse(params);
  if (!parsedCanvasTabRequest.success) {
    const parsedUserInputRequest = DesignerUserInputRequestDynamicToolCallSchema.safeParse(params);
    if (parsedUserInputRequest.success) {
      return {
        action: DesignerUserInputRequestAction,
        input: parsedUserInputRequest.data.arguments,
      };
    }

    const identity = DashboardControlDynamicToolCallIdentitySchema.safeParse(params);
    if (
      identity.success &&
      identity.data.namespace === DashboardControlDynamicToolNamespace &&
      identity.data.tool === DesignerCanvasTabShowDynamicToolName
    ) {
      return createDashboardControlDynamicToolCallResponse({
        success: false,
        text: "Designer canvas tab input is invalid.",
      });
    }

    if (
      identity.success &&
      identity.data.namespace === DashboardControlDynamicToolNamespace &&
      identity.data.tool === DesignerUserInputRequestDynamicToolName
    ) {
      return createDashboardControlDynamicToolCallResponse({
        success: false,
        text: "Designer user input request is invalid.",
      });
    }

    return createDashboardControlDynamicToolCallResponse({
      success: false,
      text: "Dashboard control action input is invalid.",
    });
  }

  const requestedTab = parsedCanvasTabRequest.data.arguments.tab;
  if (requestedTab.kind === "route") {
    return {
      action: DesignerCanvasTabOpenAction,
      input: requestedTab,
    };
  }

  return {
    action: DesignerBlueprintTabUpsertAction,
    input: requestedTab,
  };
}

export function createDashboardControlUserInputServerRequest(input: {
  requestId: string | number;
  userInput: DesignerUserInputRequestInput;
}): ToolRequestUserInputEntry {
  const freeFormOption = createDashboardControlFreeFormUserInputOption(input.userInput.freeForm);

  return {
    requestId: input.requestId,
    method: "tool/requestUserInput",
    kind: "tool-user-input",
    questions: [
      {
        header: input.userInput.header ?? null,
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
        ...(input.userInput.submitBehavior === undefined
          ? {}
          : { submitBehavior: input.userInput.submitBehavior }),
        ...(input.userInput.inputKind === "integrationConnectionResourceMultiSelect"
          ? {}
          : {
              options: [
                ...(input.userInput.options ?? []).map((option) => ({
                  label: option.label,
                  isOther: false,
                })),
                ...(freeFormOption === null ? [] : [freeFormOption]),
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
  const cancel = z
    .object({
      decision: z.literal("cancel"),
    })
    .safeParse(input.result);

  if (cancel.success) {
    return createDashboardControlDynamicToolCallResponse({
      success: true,
      text: JSON.stringify({
        decision: "cancel",
      }),
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
                kind: z.literal("sandbox-profile-draft-updated"),
                profileId: z.string().min(1),
                version: z.number().int().min(1),
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

  return createDashboardControlDynamicToolCallResponse({
    success: true,
    text: JSON.stringify({
      answers: parsed.data.answers,
    }),
  });
}

export function createDashboardControlDynamicToolCallResponse(input: {
  success: boolean;
  text: string;
}): DashboardControlDynamicToolCallResponse {
  return {
    contentItems: [
      {
        type: "inputText",
        text: input.text,
      },
    ],
    success: input.success,
  };
}

function isDashboardInternalAbsolutePath(href: string): boolean {
  if (!href.startsWith("/") || href.startsWith("//")) {
    return false;
  }

  try {
    const parsedUrl = new URL(href, "https://dashboard.mistle.local");
    return (
      parsedUrl.origin === "https://dashboard.mistle.local" &&
      `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}` === href
    );
  } catch {
    return false;
  }
}
