import type { CodexDynamicToolSpec } from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import { z } from "zod";

import {
  DesignerBlueprintCurrentTabHref,
  DesignerBlueprintCurrentTabId,
  DesignerBlueprintDocumentSchema,
  isDashboardInternalAbsolutePath,
} from "../../designer/designer-blueprint-schema.js";
import {
  DashboardControlDynamicToolNamespace,
  DesignerCanvasTabShowDynamicToolName,
} from "./constants.js";

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

export const DesignerCanvasTabShowDynamicToolCallSchema = z
  .object({
    namespace: z.literal(DashboardControlDynamicToolNamespace),
    tool: z.literal(DesignerCanvasTabShowDynamicToolName),
    arguments: DesignerCanvasTabShowInputSchema,
  })
  .loose();

export type DesignerCanvasRouteTabShowInput = z.output<
  typeof DesignerCanvasRouteTabShowInputSchema
>;
export type DesignerBlueprintTabShowInput = z.output<typeof DesignerBlueprintTabShowInputSchema>;

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
    conditionLabel: {
      type: "string",
      minLength: 1,
      maxLength: 160,
      description:
        'Short visible branch outcome or condition, shown after "If" in the routing row. Use concise labels such as "Changes requested"; do not include an "If" prefix.',
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
      description:
        "Optional destination item id for the visible next step in the routing row. Must reference an item in blueprint.items.",
    },
  },
  required: ["conditionLabel", "when"],
};

const DesignerBlueprintTriggerWhenJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    label: {
      type: "string",
      minLength: 1,
      maxLength: 160,
      description:
        'Short visible trigger condition, shown after "When" in the trigger note. Use a generic condition such as "Readiness signal received" when the exact provider condition is not known.',
    },
  },
  required: ["label"],
};

const DesignerBlueprintCommonItemJsonSchemaProperties = {
  id: {
    type: "string",
    minLength: 1,
    maxLength: 128,
    description: "Stable item id. Must be unique within blueprint.items.",
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
    label: {
      type: "string",
      minLength: 1,
      maxLength: 160,
      description: "Visible item title shown in the blueprint note.",
    },
    description: {
      type: "string",
      minLength: 1,
      maxLength: 2000,
      description: "Optional visible body text shown below the item title.",
    },
  },
  required: ["id", "kind", "label", "state"],
};

const DesignerBlueprintTriggerItemJsonSchema = {
  type: "object",
  additionalProperties: false,
  description:
    "Workflow-start trigger item. Use this for provider, schedule, or system events that start or advance the workflow; use when rows for the visible trigger conditions, and include integrationTargetKey when a real Mistle integration target is selected or known.",
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
    when: {
      type: "array",
      items: DesignerBlueprintTriggerWhenJsonSchema,
      minItems: 1,
      maxItems: 20,
      description:
        'Visible trigger condition rows. The dashboard displays each condition as "When {label}". Prefer these rows over prose descriptions for trigger criteria.',
    },
  },
  required: ["id", "kind", "state", "when"],
};

const DesignerBlueprintRoutingPolicyItemJsonSchema = {
  type: "object",
  additionalProperties: false,
  description:
    "Routing table item. The dashboard emphasizes rules as condition-to-next-step rows and does not use the item label as the primary visible title.",
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
      description:
        'Visible route table rows. The dashboard displays each rule as "If {conditionLabel} -> {routeTo item label}".',
    },
  },
  required: ["id", "kind", "state", "rules"],
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
      description:
        "Goal the workflow should accomplish. The dashboard shows this as an unconnected note at the top of the blueprint canvas; do not duplicate it as a workflow_output item.",
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
