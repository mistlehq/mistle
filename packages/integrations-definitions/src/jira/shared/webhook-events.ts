import type { IntegrationWebhookEventDefinition } from "@mistle/integrations-core";

const JiraIssueConversationKeyOption = {
  id: "issue",
  label: "Issue",
  description: "Events from the same Jira issue go to the same conversation.",
  template: "{{payload.issue.key}}",
} as const;

const JiraIssueKeyParameter = {
  id: "issueKey",
  label: "issue",
  kind: "string",
  payloadPath: ["issue", "key"],
  prefix: "for",
  placeholder: "PROJ-123",
} as const;

const JiraActorParameter = {
  id: "actor",
  label: "actor",
  kind: "string",
  payloadPath: ["user", "accountId"],
  prefix: "by",
  placeholder: "Any actor",
} as const;

type JiraWebhookEventType =
  | "jira:issue_created"
  | "jira:issue_updated"
  | "comment_created"
  | "comment_updated";

type JiraWebhookEventMetadata = {
  category: string;
  displayName: string;
  eventType: JiraWebhookEventType;
};

function createJiraWebhookEventDefinition(
  input: JiraWebhookEventMetadata,
): IntegrationWebhookEventDefinition {
  return {
    eventType: input.eventType,
    providerEventType: input.eventType,
    displayName: input.displayName,
    category: input.category,
    conversationKeyOptions: [JiraIssueConversationKeyOption],
    parameters: [JiraIssueKeyParameter, JiraActorParameter],
  };
}

export const JiraWebhookEventMetadata = {
  ISSUE_CREATED: {
    eventType: "jira:issue_created",
    displayName: "Issue created",
    category: "Issues",
  },
  ISSUE_UPDATED: {
    eventType: "jira:issue_updated",
    displayName: "Issue updated",
    category: "Issues",
  },
  COMMENT_CREATED: {
    eventType: "comment_created",
    displayName: "Comment created",
    category: "Comments",
  },
  COMMENT_UPDATED: {
    eventType: "comment_updated",
    displayName: "Comment updated",
    category: "Comments",
  },
} as const satisfies Record<string, JiraWebhookEventMetadata>;

export const JiraManagedWebhookEvents = Object.freeze(
  Object.values(JiraWebhookEventMetadata).map((event) => event.eventType),
);

export const JiraWebhookEventDisplayNameByType = new Map<string, string>(
  Object.values(JiraWebhookEventMetadata).map((event) => [event.eventType, event.displayName]),
);

export const JiraSupportedWebhookEvents: readonly IntegrationWebhookEventDefinition[] =
  Object.freeze(
    Object.values(JiraWebhookEventMetadata).map((event) => createJiraWebhookEventDefinition(event)),
  );
