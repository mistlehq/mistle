import type { IntegrationWebhookEventDefinition } from "@mistle/integrations-core";

export const GitHubSupportedWebhookEvents: readonly IntegrationWebhookEventDefinition[] = [
  {
    eventType: "github.issue_comment.created",
    providerEventType: "issue_comment",
    displayName: "Issue comment created",
    category: "Issues",
  },
  {
    eventType: "github.pull_request.opened",
    providerEventType: "pull_request",
    displayName: "Pull request opened",
    category: "Pull requests",
  },
  {
    eventType: "github.pull_request_review_comment.created",
    providerEventType: "pull_request_review_comment",
    displayName: "Pull request review comment created",
    category: "Pull requests",
  },
];
