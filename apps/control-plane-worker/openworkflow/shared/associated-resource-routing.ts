import type {
  AssociatedResourceEventRouting,
  AssociatedResourceEventType,
  GitHubPullRequestAssociatedResourceEventRoutingResourceRule,
  SlackThreadAssociatedResourceEventRoutingResourceRule,
} from "@mistle/integrations-core";
import {
  AssociatedProviderResourceKinds,
  AssociatedResourceEventTypes,
  SlackThreadMessageModes,
} from "@mistle/integrations-core";
import { parseWebhookPayloadFilter } from "@mistle/webhooks";

import { evaluateWebhookPayloadFilter } from "./webhook-payload-filter-evaluator.js";

export function supportsAssociatedResourceEvent(input: {
  eventType: AssociatedResourceEventType;
  payload: Record<string, unknown>;
  resourceKind: string;
  routing: AssociatedResourceEventRouting | null;
  sourceWebhookEventType: string;
}): boolean {
  if (input.routing === null || !input.routing.enabled) {
    return false;
  }

  return input.routing.resources.some((resource) => {
    if (resource.resourceKind !== input.resourceKind) {
      return false;
    }

    switch (resource.resourceKind) {
      case AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST:
        return githubPullRequestRuleSupportsAssociatedResourceEvent({
          eventType: input.eventType,
          payload: input.payload,
          resource,
        });
      case AssociatedProviderResourceKinds.SLACK_THREAD:
        return slackThreadRuleSupportsAssociatedResourceEvent({
          eventType: input.eventType,
          payload: input.payload,
          resource,
          sourceWebhookEventType: input.sourceWebhookEventType,
        });
    }
  });
}

function githubPullRequestRuleSupportsAssociatedResourceEvent(input: {
  eventType: AssociatedResourceEventType;
  payload: Record<string, unknown>;
  resource: GitHubPullRequestAssociatedResourceEventRoutingResourceRule;
}): boolean {
  switch (input.eventType) {
    case AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_ISSUE_COMMENT_CREATED:
    case AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_REVIEW_SUBMITTED:
    case AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_REVIEW_COMMENT_CREATED:
      if (!input.resource.eventTypes.includes(input.eventType)) {
        return false;
      }
      return payloadFilterAllowsAssociatedResourceEvent({
        payload: input.payload,
        eventScopedPayloadFilter: input.resource.payloadFilter?.[input.eventType],
      });
    case AssociatedResourceEventTypes.SLACK_THREAD_MESSAGE_CREATED:
      return false;
  }
}

function slackThreadRuleSupportsAssociatedResourceEvent(input: {
  eventType: AssociatedResourceEventType;
  payload: Record<string, unknown>;
  resource: SlackThreadAssociatedResourceEventRoutingResourceRule;
  sourceWebhookEventType: string;
}): boolean {
  switch (input.eventType) {
    case AssociatedResourceEventTypes.SLACK_THREAD_MESSAGE_CREATED:
      if (!input.resource.eventTypes.includes(input.eventType)) {
        return false;
      }
      if (
        input.resource.messageMode === SlackThreadMessageModes.APP_MENTIONS_ONLY &&
        input.sourceWebhookEventType !== "slack:app_mention"
      ) {
        return false;
      }
      return payloadFilterAllowsAssociatedResourceEvent({
        payload: input.payload,
        eventScopedPayloadFilter: input.resource.payloadFilter?.[input.eventType],
      });
    case AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_ISSUE_COMMENT_CREATED:
    case AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_REVIEW_SUBMITTED:
    case AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_REVIEW_COMMENT_CREATED:
      return false;
  }
}

function payloadFilterAllowsAssociatedResourceEvent(input: {
  eventScopedPayloadFilter: unknown;
  payload: Record<string, unknown>;
}): boolean {
  if (input.eventScopedPayloadFilter === undefined) {
    return true;
  }

  const filter = parseWebhookPayloadFilter(input.eventScopedPayloadFilter);
  return evaluateWebhookPayloadFilter({
    filter,
    payload: input.payload,
  });
}
