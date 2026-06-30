import { TriggerKinds } from "@mistle/db/control-plane";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { mcpCreateTriggerInputSchema, mcpUpdateTriggerInputSchema } from "./tool-schemas.js";

const WebhookTriggerActorPolicy = {
  anyOf: [
    {
      kind: "resource",
      actor: {
        resourceKind: "user",
        handle: "octocat",
      },
    },
    {
      kind: "relationship",
      relationshipKind: "member",
      actorSet: {
        resourceKind: "team",
        externalId: "team-1",
      },
      scope: {
        resourceKind: "organization",
        resourceId: "res_organization_1",
      },
    },
  ],
  noneOf: [
    {
      kind: "resource",
      actor: {
        resourceKind: "user",
        handle: "blocked-user",
      },
    },
  ],
};

describe("MCP trigger tool schemas", () => {
  it("advertises actor policies as requiring a non-empty allow or deny rule list", () => {
    const jsonSchema = z.toJSONSchema(mcpCreateTriggerInputSchema);

    const serializedSchema = JSON.stringify(jsonSchema);
    expect(serializedSchema).toContain('"anyOf"');
    expect(serializedSchema).toContain('"required":["anyOf"]');
    expect(serializedSchema).toContain('"required":["noneOf"]');
    expect(serializedSchema).not.toContain('"attributeKey"');
  });

  it("preserves webhook event actor policies in create_trigger input", () => {
    const input = {
      kind: TriggerKinds.WEBHOOK,
      name: "GitHub mention trigger",
      enabled: true,
      integrationWebhookSourceId: "webhook_source_1",
      eventConditions: [
        {
          eventType: "issues.opened",
          actorPolicy: WebhookTriggerActorPolicy,
          payloadFilter: {
            action: "opened",
          },
        },
      ],
      inputTemplate: "{{ event.body }}",
      instructions: "Handle the issue.",
      conversationKeyTemplate: "{{ event.issue.node_id }}",
      idempotencyKeyTemplate: "{{ event.delivery_id }}",
      target: {
        sandboxProfileId: "sbp_123",
        sandboxProfileVersion: 1,
        primaryRepositoryId: "repo_1",
      },
    };

    expect(mcpCreateTriggerInputSchema.parse(input)).toEqual(input);
  });

  it("preserves webhook event actor policies in update_trigger input", () => {
    const input = {
      kind: TriggerKinds.WEBHOOK,
      triggerId: "trg_123",
      eventConditions: [
        {
          eventType: "issues.opened",
          actorPolicy: WebhookTriggerActorPolicy,
        },
      ],
    };

    expect(mcpUpdateTriggerInputSchema.parse(input)).toEqual(input);
  });
});
