import { z } from "zod";

export const DesignerBlueprintCurrentTabHref = "/designer/blueprints/current";
export const DesignerBlueprintCurrentTabId = "designer-blueprint-current";
export const DesignerBlueprintSerializedSizeLimitBytes = 65_536;

const DesignerBlueprintItemStateSchema = z.enum([
  "proposed",
  "needs_setup",
  "ready_to_confirm",
  "applied",
  "blocked",
]);

const DesignerBlueprintCommonItemSchema = z
  .object({
    id: z.string().min(1).max(128),
    label: z.string().min(1).max(160),
    description: z.string().min(1).max(2_000).optional(),
    parentId: z.string().min(1).max(128).optional(),
    state: DesignerBlueprintItemStateSchema,
  })
  .strict();

const DesignerBlueprintConditionValueSchema = z.union([
  z.string(),
  z.array(z.string().min(1)).min(1).max(50),
  z.number(),
  z.boolean(),
]);

const DesignerBlueprintRoutingConditionSchema = z
  .object({
    field: z.string().min(1).max(128),
    operator: z.enum(["equals", "not_equals", "includes", "excludes", "in", "empty", "not_empty"]),
    value: DesignerBlueprintConditionValueSchema.optional(),
  })
  .strict();

const DesignerBlueprintRoutingRuleSchema = z
  .object({
    label: z.string().min(1).max(160).optional(),
    when: z.array(DesignerBlueprintRoutingConditionSchema).min(1).max(20),
    routeTo: z.string().min(1).max(128).optional(),
  })
  .strict();

const DesignerBlueprintRoutingPolicyItemSchema = DesignerBlueprintCommonItemSchema.extend({
  kind: z.literal("routing_policy"),
  rules: z.array(DesignerBlueprintRoutingRuleSchema).min(1).max(20),
}).strict();

const DesignerBlueprintTriggerItemSchema = DesignerBlueprintCommonItemSchema.extend({
  kind: z.literal("trigger"),
  integrationTargetKey: z.string().min(1).max(128).optional(),
  integrationLabel: z.string().min(1).max(80).optional(),
  eventLabel: z.string().min(1).max(160).optional(),
}).strict();

const DesignerBlueprintStandardItemSchema = DesignerBlueprintCommonItemSchema.extend({
  kind: z.enum(["agent_step", "workflow_output"]),
}).strict();

const DesignerBlueprintItemSchema = z.discriminatedUnion("kind", [
  DesignerBlueprintStandardItemSchema,
  DesignerBlueprintTriggerItemSchema,
  DesignerBlueprintRoutingPolicyItemSchema,
]);

const DesignerBlueprintLinkSchema = z
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

const DesignerBlueprintActionSchema = z
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

export const DesignerBlueprintDocumentSchema = z
  .object({
    version: z.literal(1),
    title: z.string().min(1).max(160),
    outcome: z
      .object({
        label: z.string().min(1).max(160),
        description: z.string().min(1).max(2_000).optional(),
      })
      .strict(),
    items: z.array(DesignerBlueprintItemSchema).max(100),
    links: z.array(DesignerBlueprintLinkSchema).max(200),
    actions: z.array(DesignerBlueprintActionSchema).max(50),
  })
  .strict()
  .superRefine((blueprint, ctx) => {
    const serializedSize = new TextEncoder().encode(JSON.stringify(blueprint)).byteLength;
    if (serializedSize > DesignerBlueprintSerializedSizeLimitBytes) {
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

export type DesignerBlueprintDocument = z.output<typeof DesignerBlueprintDocumentSchema>;
export type DesignerBlueprintItem = DesignerBlueprintDocument["items"][number];
export type DesignerBlueprintAction = DesignerBlueprintDocument["actions"][number];

export function isDashboardInternalAbsolutePath(href: string): boolean {
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
