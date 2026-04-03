import { GitHubCloudDefinition } from "@mistle/integrations-definitions";
import { describe, expect, it } from "vitest";

import {
  AgentInstructionTokenGroups,
  buildAgentInstructionTokenCatalog,
} from "./agent-instructions-token-catalog.js";
import { createWebhookAutomationTriggerId } from "./webhook-automation-option-builders.js";
import { GitHubConnectionId, GitHubConnectionLabel } from "./webhook-automation-test-fixtures.js";
import type { WebhookAutomationEventOption } from "./webhook-automation-trigger-types.js";

function createGitHubEventOption(input: {
  eventType: string;
  overrides?: Partial<WebhookAutomationEventOption>;
}): WebhookAutomationEventOption {
  const eventDefinition = GitHubCloudDefinition.supportedWebhookEvents?.find(
    (candidate) => candidate.eventType === input.eventType,
  );

  if (eventDefinition === undefined) {
    throw new Error(`Missing GitHub event definition for '${input.eventType}'.`);
  }

  return {
    id: createWebhookAutomationTriggerId({
      connectionId: GitHubConnectionId,
      eventType: eventDefinition.eventType,
    }),
    eventType: eventDefinition.eventType,
    connectionId: GitHubConnectionId,
    connectionLabel: GitHubConnectionLabel,
    label: eventDefinition.displayName,
    ...(eventDefinition.category === undefined ? {} : { category: eventDefinition.category }),
    payloadReferences:
      eventDefinition.payloadReferences === undefined ? [] : [...eventDefinition.payloadReferences],
    conversationKeyOptions:
      eventDefinition.conversationKeyOptions === undefined
        ? []
        : [...eventDefinition.conversationKeyOptions],
    parameters: eventDefinition.parameters === undefined ? [] : [...eventDefinition.parameters],
    ...input.overrides,
  };
}

describe("buildAgentInstructionTokenCatalog", () => {
  it("always includes shared runtime tokens", () => {
    const tokens = buildAgentInstructionTokenCatalog({
      selectedEventOptions: [],
    });

    expect(tokens.some((token) => token.path === "webhookEvent.eventType")).toBe(true);
    expect(tokens.some((token) => token.path === "automationRun.id")).toBe(true);
    expect(tokens.some((token) => token.path === "automationRun.automationId")).toBe(false);
    expect(tokens.some((token) => token.path === "payload")).toBe(true);
  });

  it("derives payload tokens from selected event payload references", () => {
    const tokens = buildAgentInstructionTokenCatalog({
      selectedEventOptions: [
        createGitHubEventOption({ eventType: "github.issue_comment.created" }),
      ],
    });

    expect(tokens.some((token) => token.path === "payload.comment.body")).toBe(true);
    expect(tokens.some((token) => token.path === "payload.repository.full_name")).toBe(true);
    expect(tokens.some((token) => token.path === "payload.issue.pull_request")).toBe(true);
    expect(tokens.some((token) => token.path === "payload.sender.login")).toBe(true);
  });

  it("deduplicates repeated payload paths across selected events", () => {
    const tokens = buildAgentInstructionTokenCatalog({
      selectedEventOptions: [
        createGitHubEventOption({ eventType: "github.issue_comment.created" }),
        createGitHubEventOption({
          eventType: "github.pull_request.opened",
          payloadReferences: [
            {
              path: ["comment", "body"],
              description: "Comment text",
            },
          ],
        }),
      ],
    });

    expect(tokens.filter((token) => token.path === "payload.comment.body")).toHaveLength(1);
  });

  it("uses payload reference descriptions", () => {
    const tokens = buildAgentInstructionTokenCatalog({
      selectedEventOptions: [
        createGitHubEventOption({ eventType: "github.issue_comment.created" }),
      ],
    });

    expect(tokens.find((token) => token.path === "payload.comment.body")?.description).toBe(
      "Comment text",
    );
  });

  it("does not derive payload tokens from trigger parameters", () => {
    const tokens = buildAgentInstructionTokenCatalog({
      selectedEventOptions: [
        createGitHubEventOption({
          eventType: "github.issue_comment.created",
          payloadReferences: [],
          parameters: [
            {
              id: "unknown-field",
              label: "unknown field",
              kind: "string",
              payloadPath: ["unknown", "field"],
            },
          ],
        }),
      ],
    });

    expect(tokens.some((token) => token.path === "payload.unknown.field")).toBe(false);
  });

  it("keeps shared runtime groups ahead of payload tokens", () => {
    const tokens = buildAgentInstructionTokenCatalog({
      selectedEventOptions: [
        createGitHubEventOption({ eventType: "github.issue_comment.created" }),
      ],
    });

    const firstPayloadIndex = tokens.findIndex(
      (token) => token.group === AgentInstructionTokenGroups.PAYLOAD && token.path !== "payload",
    );
    const webhookEventIndex = tokens.findIndex(
      (token) => token.group === AgentInstructionTokenGroups.WEBHOOK_EVENT,
    );

    expect(webhookEventIndex).toBeGreaterThanOrEqual(0);
    expect(firstPayloadIndex).toBeGreaterThan(webhookEventIndex);
  });
});
