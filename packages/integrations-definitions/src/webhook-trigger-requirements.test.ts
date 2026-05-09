import type {
  AnyIntegrationDefinition,
  IntegrationWebhookEventDefinition,
} from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { listIntegrationDefinitions } from "./index.js";

describe("webhook trigger requirements", () => {
  it("declares requirements for every built-in webhook trigger", () => {
    const triggerCapableDefinitions = listIntegrationDefinitions().filter(
      (definition) => (definition.supportedWebhookEvents?.length ?? 0) > 0,
    );

    expect(triggerCapableDefinitions.map(toDefinitionKey)).toEqual([
      "jira::jira-default",
      "github::github-cloud",
      "github::github-enterprise-server",
      "slack::slack-default",
    ]);

    for (const definition of triggerCapableDefinitions) {
      for (const eventDefinition of definition.supportedWebhookEvents ?? []) {
        const requirements = eventDefinition.requirements;

        if (requirements === undefined || requirements.anyOf.length === 0) {
          throw new Error(`Missing requirements for ${eventDefinition.eventType}.`);
        }

        expect(
          requirements.anyOf.some((requirementSet) => requirementSet.event !== undefined),
        ).toBe(true);
      }
    }
  });

  it("maps GitHub trigger requirements to GitHub App event subscriptions and permissions", () => {
    const githubDefinition = requireDefinition("github", "github-cloud");

    expect(requireEvent(githubDefinition, "github.issues.opened").requirements).toEqual({
      anyOf: [{ event: "issues", permissions: [{ permission: "issues", access: "read" }] }],
    });

    expect(requireEvent(githubDefinition, "github.pull_request.opened").requirements).toEqual({
      anyOf: [
        {
          event: "pull_request",
          permissions: [{ permission: "pull_requests", access: "read" }],
        },
      ],
    });

    expect(requireEvent(githubDefinition, "github.push.pushed").requirements).toEqual({
      anyOf: [{ event: "push", permissions: [{ permission: "contents", access: "read" }] }],
    });

    expect(requireEvent(githubDefinition, "github.check_suite.completed").requirements).toEqual({
      anyOf: [{ event: "check_suite", permissions: [{ permission: "checks", access: "read" }] }],
    });
  });

  it("maps Slack trigger requirements to Events API subscriptions and bot scopes", () => {
    const slackDefinition = requireDefinition("slack", "slack-default");

    expect(requireEvent(slackDefinition, "slack:message").requirements).toEqual({
      anyOf: [
        {
          label: "Public channels",
          event: "message.channels",
          permissions: [{ permission: "channels:history" }],
        },
        {
          label: "Private channels",
          event: "message.groups",
          permissions: [{ permission: "groups:history" }],
        },
      ],
    });

    expect(requireEvent(slackDefinition, "slack:app_mention").requirements).toEqual({
      anyOf: [{ event: "app_mention", permissions: [{ permission: "app_mentions:read" }] }],
    });

    expect(requireEvent(slackDefinition, "slack:reaction_added").requirements).toEqual({
      anyOf: [{ event: "reaction_added", permissions: [{ permission: "reactions:read" }] }],
    });
  });

  it("maps Jira trigger requirements to managed webhook events and webhook scopes", () => {
    const jiraDefinition = requireDefinition("jira", "jira-default");

    expect(requireEvent(jiraDefinition, "jira:issue_created").requirements).toEqual({
      anyOf: [
        {
          event: "jira:issue_created",
          permissions: [{ permission: "read:jira-work" }, { permission: "manage:jira-webhook" }],
        },
      ],
    });

    expect(requireEvent(jiraDefinition, "comment_created").requirements).toEqual({
      anyOf: [
        {
          event: "comment_created",
          permissions: [{ permission: "read:jira-work" }, { permission: "manage:jira-webhook" }],
        },
      ],
    });
  });
});

function requireDefinition(familyId: string, variantId: string): AnyIntegrationDefinition {
  const definition = listIntegrationDefinitions().find(
    (candidate) => candidate.familyId === familyId && candidate.variantId === variantId,
  );

  if (definition === undefined) {
    throw new Error(`Missing integration definition ${familyId}::${variantId}.`);
  }

  return definition;
}

function requireEvent(
  definition: AnyIntegrationDefinition,
  eventType: string,
): IntegrationWebhookEventDefinition {
  const eventDefinition = definition.supportedWebhookEvents?.find(
    (candidate) => candidate.eventType === eventType,
  );

  if (eventDefinition === undefined) {
    throw new Error(`Missing webhook event ${toDefinitionKey(definition)}::${eventType}.`);
  }

  return eventDefinition;
}

function toDefinitionKey(definition: AnyIntegrationDefinition): string {
  return `${definition.familyId}::${definition.variantId}`;
}
