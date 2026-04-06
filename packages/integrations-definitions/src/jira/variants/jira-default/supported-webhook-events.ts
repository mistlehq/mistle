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

function createJiraWebhookEventDefinition(input: {
  eventType: "jira:issue_created" | "jira:issue_updated" | "comment_created" | "comment_updated";
  displayName: string;
  category: string;
}): IntegrationWebhookEventDefinition {
  return {
    eventType: input.eventType,
    providerEventType: input.eventType,
    displayName: input.displayName,
    category: input.category,
    conversationKeyOptions: [JiraIssueConversationKeyOption],
    parameters: [JiraIssueKeyParameter, JiraActorParameter],
  };
}

export const JiraManagedWebhookEvents = [
  "jira:issue_created",
  "jira:issue_updated",
  "comment_created",
  "comment_updated",
] as const;

export const JiraSupportedWebhookEvents: readonly IntegrationWebhookEventDefinition[] = [
  createJiraWebhookEventDefinition({
    eventType: "jira:issue_created",
    displayName: "Issue created",
    category: "Issues",
  }),
  createJiraWebhookEventDefinition({
    eventType: "jira:issue_updated",
    displayName: "Issue updated",
    category: "Issues",
  }),
  createJiraWebhookEventDefinition({
    eventType: "comment_created",
    displayName: "Comment created",
    category: "Comments",
  }),
  createJiraWebhookEventDefinition({
    eventType: "comment_updated",
    displayName: "Comment updated",
    category: "Comments",
  }),
] as const;
