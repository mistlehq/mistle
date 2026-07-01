import type {
  IntegrationWebhookEventDefinition,
  IntegrationWebhookEventParameterDefinition,
  IntegrationWebhookPayloadReference,
  IntegrationWebhookTriggerRequirements,
} from "@mistle/integrations-core";

const SentryIssueConversationKeyOption = {
  id: "issue",
  label: "Issue",
  description: "Events from the same Sentry issue go to the same conversation.",
  template: "{{payload.data.issue.id}}",
};

const SentryIssuePayloadReferences: readonly IntegrationWebhookPayloadReference[] = [
  {
    path: ["data", "issue"],
    description: "Sentry issue object.",
  },
  {
    path: ["data", "issue", "id"],
    description: "Sentry issue ID.",
  },
  {
    path: ["data", "issue", "shortId"],
    description: "Sentry issue short ID.",
  },
  {
    path: ["data", "issue", "title"],
    description: "Sentry issue title.",
  },
  {
    path: ["data", "issue", "web_url"],
    description: "Sentry issue web URL.",
  },
  {
    path: ["data", "issue", "project", "slug"],
    description: "Sentry project slug.",
  },
  {
    path: ["data", "issue", "status"],
    description: "Sentry issue status.",
  },
  {
    path: ["data", "issue", "substatus"],
    description: "Sentry issue substatus.",
  },
  {
    path: ["data", "issue", "issueCategory"],
    description: "Sentry issue category.",
  },
  {
    path: ["data", "issue", "issueType"],
    description: "Sentry issue type.",
  },
  {
    path: ["actor"],
    description: "Actor that triggered the Sentry issue webhook.",
  },
];

const SentryProjectSlugParameter: IntegrationWebhookEventParameterDefinition = {
  id: "projectSlug",
  label: "project",
  kind: "string",
  payloadPath: ["data", "issue", "project", "slug"],
  prefix: "in",
  placeholder: "project-slug",
};

const SentryIssueTitleParameter: IntegrationWebhookEventParameterDefinition = {
  id: "issueTitle",
  label: "title",
  kind: "string",
  payloadPath: ["data", "issue", "title"],
  prefix: "with title containing",
  placeholder: "Error generated with event_id",
};

const SentryIssueParameters = [SentryProjectSlugParameter, SentryIssueTitleParameter];

function createSentryIssueWebhookRequirements(): IntegrationWebhookTriggerRequirements {
  return {
    anyOf: [
      {
        event: "issue",
      },
    ],
  };
}

function createSentryIssueWebhookEventDefinition(input: {
  action: string;
  displayName: string;
}): IntegrationWebhookEventDefinition {
  return {
    eventType: `sentry.issue.${input.action}`,
    providerEventType: `issue.${input.action}`,
    displayName: input.displayName,
    category: "Issue",
    requirements: createSentryIssueWebhookRequirements(),
    payloadReferences: SentryIssuePayloadReferences,
    conversationKeyOptions: [SentryIssueConversationKeyOption],
    parameters: SentryIssueParameters,
  };
}

// Source: https://docs.sentry.io/integrations/integration-platform/webhooks/issues/
export const SentrySupportedWebhookEvents = [
  createSentryIssueWebhookEventDefinition({
    action: "created",
    displayName: "Issue created",
  }),
  createSentryIssueWebhookEventDefinition({
    action: "resolved",
    displayName: "Issue resolved",
  }),
  createSentryIssueWebhookEventDefinition({
    action: "assigned",
    displayName: "Issue assigned",
  }),
  createSentryIssueWebhookEventDefinition({
    action: "archived",
    displayName: "Issue archived",
  }),
  createSentryIssueWebhookEventDefinition({
    action: "unresolved",
    displayName: "Issue unresolved",
  }),
] satisfies readonly IntegrationWebhookEventDefinition[];
