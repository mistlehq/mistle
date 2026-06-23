import { z } from "@hono/zod-openapi";
import { SandboxInstanceStatuses } from "@mistle/sandbox-lifecycle";

const designerBlueprintSerializedSizeLimitBytes = 65_536;

const designerBlueprintItemStateSchema = z.enum([
  "proposed",
  "needs_setup",
  "ready_to_confirm",
  "applied",
  "blocked",
]);

const designerBlueprintCommonItemSchema = z
  .object({
    id: z.string().min(1).max(128),
    label: z.string().min(1).max(160),
    description: z.string().min(1).max(2_000).optional(),
    parentId: z.string().min(1).max(128).optional(),
    state: designerBlueprintItemStateSchema,
  })
  .strict();

const designerBlueprintConditionValueSchema = z.union([
  z.string(),
  z.array(z.string().min(1)).min(1).max(50),
  z.number(),
  z.boolean(),
]);

const designerBlueprintRoutingConditionSchema = z
  .object({
    field: z.string().min(1).max(128),
    operator: z.enum(["equals", "not_equals", "includes", "excludes", "in", "empty", "not_empty"]),
    value: designerBlueprintConditionValueSchema.optional(),
  })
  .strict();

const designerBlueprintRoutingRuleSchema = z
  .object({
    label: z.string().min(1).max(160).optional(),
    when: z.array(designerBlueprintRoutingConditionSchema).min(1).max(20),
    routeTo: z.string().min(1).max(128).optional(),
  })
  .strict();

const designerBlueprintRoutingPolicyItemSchema = designerBlueprintCommonItemSchema
  .extend({
    kind: z.literal("routing_policy"),
    rules: z.array(designerBlueprintRoutingRuleSchema).min(1).max(20),
  })
  .strict();

const designerBlueprintTriggerItemSchema = designerBlueprintCommonItemSchema
  .extend({
    kind: z.literal("trigger"),
    integrationTargetKey: z.string().min(1).max(128).optional(),
    integrationLabel: z.string().min(1).max(80).optional(),
    eventLabel: z.string().min(1).max(160).optional(),
  })
  .strict();

const designerBlueprintStandardItemSchema = designerBlueprintCommonItemSchema
  .extend({
    kind: z.enum(["agent_step", "workflow_output"]),
  })
  .strict();

const designerBlueprintItemSchema = z.discriminatedUnion("kind", [
  designerBlueprintStandardItemSchema,
  designerBlueprintTriggerItemSchema,
  designerBlueprintRoutingPolicyItemSchema,
]);

const designerBlueprintLinkSchema = z
  .object({
    from: z.string().min(1).max(128),
    to: z.string().min(1).max(128),
    kind: z.enum([
      "requires",
      "triggers",
      "configures",
      "produces",
      "confirms",
      "routes_to",
      "hands_off_to",
      "uses",
    ]),
  })
  .strict();

const designerBlueprintActionSchema = z
  .object({
    id: z.string().min(1).max(128),
    itemId: z.string().min(1).max(128),
    kind: z.enum([
      "open_integration_setup",
      "open_trigger_create",
      "open_trigger_edit",
      "open_sandbox_profile",
      "open_sandbox_profile_section",
    ]),
    label: z.string().min(1).max(160),
    href: z
      .string()
      .min(1)
      .max(2_048)
      .refine((href) => isDashboardInternalAbsolutePath(href), {
        message: "href must be a dashboard-internal absolute path.",
      }),
  })
  .strict();

const designerBlueprintDocumentSchema = z
  .object({
    version: z.literal(1),
    title: z.string().min(1).max(160),
    outcome: z
      .object({
        label: z.string().min(1).max(160),
        description: z.string().min(1).max(2_000).optional(),
      })
      .strict(),
    items: z.array(designerBlueprintItemSchema).max(100),
    links: z.array(designerBlueprintLinkSchema).max(200),
    actions: z.array(designerBlueprintActionSchema).max(50),
  })
  .strict()
  .superRefine((blueprint, ctx) => {
    const serializedSize = new TextEncoder().encode(JSON.stringify(blueprint)).byteLength;
    if (serializedSize > designerBlueprintSerializedSizeLimitBytes) {
      ctx.addIssue({
        code: "custom",
        message: "Blueprint JSON must be 64 KB or smaller.",
        path: [],
      });
    }

    const itemIds = new Set<string>();
    let itemIndex = 0;
    for (const item of blueprint.items) {
      if (itemIds.has(item.id)) {
        ctx.addIssue({
          code: "custom",
          message: "Blueprint item ids must be unique.",
          path: ["items", itemIndex, "id"],
        });
      }
      itemIds.add(item.id);
      itemIndex += 1;
    }

    let linkIndex = 0;
    for (const link of blueprint.links) {
      if (!itemIds.has(link.from)) {
        ctx.addIssue({
          code: "custom",
          message: "Blueprint link source must reference an item id.",
          path: ["links", linkIndex, "from"],
        });
      }
      if (!itemIds.has(link.to)) {
        ctx.addIssue({
          code: "custom",
          message: "Blueprint link target must reference an item id.",
          path: ["links", linkIndex, "to"],
        });
      }
      linkIndex += 1;
    }

    let parentItemIndex = 0;
    for (const item of blueprint.items) {
      const parentId = item.parentId;
      if (parentId !== undefined && !itemIds.has(parentId)) {
        ctx.addIssue({
          code: "custom",
          message: "Blueprint item parent must reference an item id.",
          path: ["items", parentItemIndex, "parentId"],
        });
      }
      if (parentId === item.id) {
        ctx.addIssue({
          code: "custom",
          message: "Blueprint item parent must not reference itself.",
          path: ["items", parentItemIndex, "parentId"],
        });
      }
      parentItemIndex += 1;
    }

    let actionIndex = 0;
    for (const action of blueprint.actions) {
      if (!itemIds.has(action.itemId)) {
        ctx.addIssue({
          code: "custom",
          message: "Blueprint action must reference an item id.",
          path: ["actions", actionIndex, "itemId"],
        });
      }
      actionIndex += 1;
    }

    let routingItemIndex = 0;
    for (const item of blueprint.items) {
      if (item.kind !== "routing_policy") {
        routingItemIndex += 1;
        continue;
      }

      let ruleIndex = 0;
      for (const rule of item.rules) {
        const routeTo = rule.routeTo;
        if (routeTo !== undefined && !itemIds.has(routeTo)) {
          ctx.addIssue({
            code: "custom",
            message: "Blueprint routing rule target must reference an item id.",
            path: ["items", routingItemIndex, "rules", ruleIndex, "routeTo"],
          });
        }
        ruleIndex += 1;
      }
      routingItemIndex += 1;
    }
  });

const designerSessionRouteCanvasTabSchema = z
  .object({
    kind: z.literal("route"),
    id: z.string().min(1).max(128),
    title: z.string().min(1).max(120),
    href: z
      .string()
      .min(1)
      .max(2_048)
      .refine((href) => isDashboardInternalAbsolutePath(href), {
        message: "href must be a dashboard-internal absolute path.",
      }),
  })
  .strict();

const designerSessionBlueprintCanvasTabSchema = z
  .object({
    kind: z.literal("blueprint"),
    id: z.literal("designer-blueprint-current"),
    title: z.string().min(1).max(120),
    href: z.literal("/designer/blueprints/current"),
    blueprint: designerBlueprintDocumentSchema,
  })
  .strict();

const designerSessionCanvasTabSchema = z.discriminatedUnion("kind", [
  designerSessionRouteCanvasTabSchema,
  designerSessionBlueprintCanvasTabSchema,
]);

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

const designerSessionSandboxStatusSchema = z.enum([
  SandboxInstanceStatuses.PENDING,
  SandboxInstanceStatuses.STARTING,
  SandboxInstanceStatuses.STARTED,
  SandboxInstanceStatuses.INITIALIZING,
  SandboxInstanceStatuses.RUNNING,
  SandboxInstanceStatuses.DEGRADED,
  SandboxInstanceStatuses.RECONNECTING,
  SandboxInstanceStatuses.STOPPING,
  SandboxInstanceStatuses.STOPPED,
  SandboxInstanceStatuses.FAILED,
]);

const designerSessionStartupOperationSchema = z
  .object({
    operationId: z.string().min(1),
    operationKind: z.enum(["start", "resume"]),
  })
  .strict();

const designerSessionRuntimeContextSchema = z
  .object({
    agentRuntimeId: z.enum(["claude-code", "codex", "opencode", "pi"]).nullable(),
    launchCwd: z.string().min(1).nullable(),
    primaryRepositoryRoot: z.string().min(1).nullable(),
  })
  .strict();

export const designerSessionIdParamsSchema = z
  .object({
    sessionId: z
      .string()
      .min(1)
      .regex(/^dsn_[a-zA-Z0-9_-]+$/, {
        message: "`sessionId` must be a designer session id.",
      }),
  })
  .strict();

export const designerSandboxInstanceIdParamsSchema = z
  .object({
    instanceId: z
      .string()
      .min(1)
      .regex(/^sbi_[a-zA-Z0-9_-]+$/, {
        message: "`instanceId` must be a sandbox instance id.",
      }),
  })
  .strict();

export const createDesignerSessionBodySchema = z
  .object({
    idempotencyKey: z.string().min(1).max(255),
    prompt: z.string().trim().min(1).max(20_000),
  })
  .strict();

export const listDesignerSessionsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

export const putDesignerSessionCanvasTabsBodySchema = z
  .object({
    tabs: z.array(designerSessionCanvasTabSchema),
  })
  .strict();

export const designerSessionSchema = z
  .object({
    id: z.string().min(1),
    organizationId: z.string().min(1),
    sandboxInstanceId: z.string().min(1),
    sandboxProfileId: z.string().min(1),
    sandboxProfileVersion: z.number().int().min(1),
    title: z.string().min(1).nullable(),
    status: designerSessionSandboxStatusSchema.nullable(),
    connectable: z.boolean(),
    failureCode: z.string().min(1).nullable(),
    failureMessage: z.string().min(1).nullable(),
    runtimeContext: designerSessionRuntimeContextSchema.nullable(),
    startupOperation: designerSessionStartupOperationSchema.nullable(),
    initialPrompt: z.string().min(1).nullable(),
    canvasTabs: z.array(designerSessionCanvasTabSchema),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();

export const createDesignerSessionResponseSchema = designerSessionSchema;

export const listDesignerSessionsResponseSchema = z
  .object({
    items: z.array(designerSessionSchema),
  })
  .strict();

export const getDesignerSessionResponseSchema = designerSessionSchema;
export const putDesignerSessionCanvasTabsResponseSchema = designerSessionSchema;

export type DesignerSessionResponse = z.infer<typeof designerSessionSchema>;
export type CreateDesignerSessionBody = z.infer<typeof createDesignerSessionBodySchema>;
export type PutDesignerSessionCanvasTabsBody = z.infer<
  typeof putDesignerSessionCanvasTabsBodySchema
>;
