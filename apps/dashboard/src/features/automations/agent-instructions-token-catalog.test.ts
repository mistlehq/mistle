import { describe, expect, it } from "vitest";

import {
  AgentInstructionTokenGroups,
  buildAgentInstructionTokenCatalog,
} from "./agent-instructions-token-catalog.js";
import {
  createGithubIssueCommentCreatedEventOption,
  createGithubPullRequestOpenedEventOption,
} from "./webhook-automation-test-fixtures.js";

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

  it("derives payload tokens from selected event parameters only", () => {
    const tokens = buildAgentInstructionTokenCatalog({
      selectedEventOptions: [createGithubIssueCommentCreatedEventOption()],
    });

    expect(tokens.some((token) => token.path === "payload.comment.body")).toBe(true);
    expect(tokens.some((token) => token.path === "payload.issue.pull_request")).toBe(true);
    expect(tokens.some((token) => token.path === "payload.sender.login")).toBe(false);
  });

  it("deduplicates repeated payload paths across selected events", () => {
    const tokens = buildAgentInstructionTokenCatalog({
      selectedEventOptions: [
        createGithubIssueCommentCreatedEventOption(),
        createGithubPullRequestOpenedEventOption({
          parameters: [
            {
              id: "repository",
              label: "repository",
              kind: "resource-select",
              resourceKind: "repository",
              payloadPath: ["comment", "body"],
            },
          ],
        }),
      ],
    });

    expect(tokens.filter((token) => token.path === "payload.comment.body")).toHaveLength(1);
  });

  it("uses curated semantic descriptions for known payload paths", () => {
    const tokens = buildAgentInstructionTokenCatalog({
      selectedEventOptions: [createGithubIssueCommentCreatedEventOption()],
    });

    expect(tokens.find((token) => token.path === "payload.comment.body")?.description).toBe(
      "Comment text",
    );
  });

  it("omits the description for unknown payload paths", () => {
    const tokens = buildAgentInstructionTokenCatalog({
      selectedEventOptions: [
        createGithubIssueCommentCreatedEventOption({
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

    expect(tokens.find((token) => token.path === "payload.unknown.field")?.description).toBe(
      undefined,
    );
  });

  it("keeps shared runtime groups ahead of payload tokens", () => {
    const tokens = buildAgentInstructionTokenCatalog({
      selectedEventOptions: [createGithubIssueCommentCreatedEventOption()],
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
