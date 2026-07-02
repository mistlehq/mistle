import type {
  AnyIntegrationDefinition,
  IntegrationWebhookEventDefinition,
} from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { listIntegrationDefinitions } from "./index.js";

const WebhookTriggerCapabilityContractCoverage = [
  {
    definition: "discord::discord-default",
    metadataProducer: "provider-configuration-setup.server.ts",
  },
  {
    definition: "jira::jira-default",
    metadataProducer: "webhook-source.server.ts createRegistration",
  },
  {
    definition: "github::github-cloud",
    metadataProducer: "shared/app-manifest.ts and shared/webhook-source.server.ts",
  },
  {
    definition: "github::github-enterprise-server",
    metadataProducer: "shared/app-manifest.ts and shared/webhook-source.server.ts",
  },
  {
    definition: "linear::linear-default",
    metadataProducer: "webhook-source.server.ts createRegistration and refreshTriggerCapabilities",
  },
  {
    definition: "sentry::sentry-default",
    metadataProducer: "webhook-source.server.ts initialSourceProviderMetadata",
  },
  {
    definition: "slack::slack-default",
    metadataProducer: "app-manifest.ts and provider-app-setup.server.ts",
  },
  {
    definition: "telegram::telegram-default",
    metadataProducer: "webhook-source.server.ts createRegistration",
  },
  {
    definition: "wasenderapi::wasenderapi-mcp",
    metadataProducer: "provider-configuration-setup.server.ts",
  },
  {
    definition: "whapi::whapi-mcp",
    metadataProducer: "channel-settings.server.ts refreshTriggerCapabilities",
  },
];

describe("webhook trigger requirements", () => {
  it("declares requirements for every built-in webhook trigger", () => {
    const triggerCapableDefinitions = listIntegrationDefinitions().filter(
      (definition) => (definition.supportedWebhookEvents?.length ?? 0) > 0,
    );

    expect(triggerCapableDefinitions.map(toDefinitionKey)).toEqual([
      "discord::discord-default",
      "jira::jira-default",
      "github::github-cloud",
      "github::github-enterprise-server",
      "linear::linear-default",
      "sentry::sentry-default",
      "slack::slack-default",
      "telegram::telegram-default",
      "wasenderapi::wasenderapi-mcp",
      "whapi::whapi-mcp",
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

  it("tracks trigger capability contract coverage for every built-in webhook trigger", () => {
    const triggerCapableDefinitionKeys = listIntegrationDefinitions()
      .filter((definition) => (definition.supportedWebhookEvents?.length ?? 0) > 0)
      .map(toDefinitionKey);

    expect(WebhookTriggerCapabilityContractCoverage.map((coverage) => coverage.definition)).toEqual(
      triggerCapableDefinitionKeys,
    );
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

  it("maps Linear trigger requirements to managed webhook resource types and admin access", () => {
    const linearDefinition = requireDefinition("linear", "linear-default");

    expect(
      linearDefinition.supportedWebhookEvents?.map((eventDefinition) => eventDefinition.eventType),
    ).toEqual([
      "linear.issue.created",
      "linear.issue.updated",
      "linear.issue.removed",
      "linear.comment.created",
      "linear.comment.updated",
      "linear.comment.removed",
      "linear.issue_label.created",
      "linear.issue_label.updated",
      "linear.issue_label.removed",
      "linear.project.created",
      "linear.project.updated",
      "linear.project.removed",
      "linear.cycle.created",
      "linear.cycle.updated",
      "linear.cycle.removed",
      "linear.reaction.created",
      "linear.reaction.updated",
      "linear.reaction.removed",
    ]);

    expectLinearEventRequirements(linearDefinition, "Issue", [
      "linear.issue.created",
      "linear.issue.updated",
      "linear.issue.removed",
    ]);
    expectLinearEventRequirements(linearDefinition, "Comment", [
      "linear.comment.created",
      "linear.comment.updated",
      "linear.comment.removed",
    ]);
    expectLinearEventRequirements(linearDefinition, "IssueLabel", [
      "linear.issue_label.created",
      "linear.issue_label.updated",
      "linear.issue_label.removed",
    ]);
    expectLinearEventRequirements(linearDefinition, "Project", [
      "linear.project.created",
      "linear.project.updated",
      "linear.project.removed",
    ]);
    expectLinearEventRequirements(linearDefinition, "Cycle", [
      "linear.cycle.created",
      "linear.cycle.updated",
      "linear.cycle.removed",
    ]);
    expectLinearEventRequirements(linearDefinition, "Reaction", [
      "linear.reaction.created",
      "linear.reaction.updated",
      "linear.reaction.removed",
    ]);
  });

  it("maps Sentry issue trigger requirements to issue webhook subscriptions", () => {
    const sentryDefinition = requireDefinition("sentry", "sentry-default");

    expect(
      sentryDefinition.supportedWebhookEvents?.map((eventDefinition) => eventDefinition.eventType),
    ).toEqual([
      "sentry.issue.created",
      "sentry.issue.resolved",
      "sentry.issue.assigned",
      "sentry.issue.archived",
      "sentry.issue.unresolved",
    ]);

    for (const eventType of [
      "sentry.issue.created",
      "sentry.issue.resolved",
      "sentry.issue.assigned",
      "sentry.issue.archived",
      "sentry.issue.unresolved",
    ]) {
      expect(requireEvent(sentryDefinition, eventType).requirements).toEqual({
        anyOf: [
          {
            event: "issue",
          },
        ],
      });
    }
  });

  it("maps Telegram trigger requirements to allowed update names", () => {
    const telegramDefinition = requireDefinition("telegram", "telegram-default");

    for (const eventDefinition of telegramDefinition.supportedWebhookEvents ?? []) {
      expect(eventDefinition.requirements).toEqual({
        anyOf: [
          {
            event: eventDefinition.providerEventType,
          },
        ],
      });
    }
  });
});

function expectLinearEventRequirements(
  definition: AnyIntegrationDefinition,
  providerEventType: string,
  eventTypes: readonly string[],
): void {
  for (const eventType of eventTypes) {
    expect(requireEvent(definition, eventType).requirements).toEqual({
      anyOf: [
        {
          event: providerEventType,
          permissions: [{ permission: "workspace-admin" }],
        },
      ],
    });
  }
}

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
