import { isWebhookAutomationEventOptionUnavailable } from "./webhook-automation-event-option-availability.js";
import type {
  WebhookAutomationConversationKeyOption,
  WebhookAutomationEventOption,
  WebhookAutomationTriggerParameterValueMap,
} from "./webhook-automation-trigger-types.js";

const GitHubIssueCommentCreatedEventType = "github.issue_comment.created";
const GitHubIssueCommentTargetParameterId = "target";
const GitHubIssueCommentPullRequestTargetValue = "exists";
export const GitHubPullRequestConversationKeyTemplate =
  "{{payload.repository.full_name}}:pull-request:{% if payload.pull_request %}{{payload.pull_request.number}}{% else %}{{payload.issue.number}}{% endif %}";

const GitHubPullRequestConversationKeyOption = {
  id: "pull-request",
  label: "Pull request",
  description: "Events from the same pull request go to the same conversation.",
  template: GitHubPullRequestConversationKeyTemplate,
} satisfies WebhookAutomationConversationKeyOption;

function shouldAddGitHubPullRequestGrouping(input: {
  eventOption: WebhookAutomationEventOption;
  triggerParameterValues: WebhookAutomationTriggerParameterValueMap;
}): boolean {
  if (input.eventOption.eventType !== GitHubIssueCommentCreatedEventType) {
    return false;
  }

  return (
    input.triggerParameterValues[input.eventOption.id]?.[GitHubIssueCommentTargetParameterId] ===
    GitHubIssueCommentPullRequestTargetValue
  );
}

function resolveContextualConversationKeyOptions(input: {
  eventOption: WebhookAutomationEventOption;
  triggerParameterValues: WebhookAutomationTriggerParameterValueMap;
}): readonly WebhookAutomationConversationKeyOption[] {
  const options = input.eventOption.conversationKeyOptions ?? [];
  if (
    !shouldAddGitHubPullRequestGrouping(input) ||
    options.some((option) => option.id === GitHubPullRequestConversationKeyOption.id)
  ) {
    return options;
  }

  return [...options, GitHubPullRequestConversationKeyOption];
}

export function resolveCommonWebhookAutomationConversationKeyOptions(input: {
  selectedEventOptions: readonly WebhookAutomationEventOption[];
  triggerParameterValues?: WebhookAutomationTriggerParameterValueMap;
}): readonly WebhookAutomationConversationKeyOption[] {
  const availableEventOptions = input.selectedEventOptions.filter(
    (eventOption) => !isWebhookAutomationEventOptionUnavailable(eventOption),
  );

  if (availableEventOptions.length === 0) {
    return [];
  }

  const [firstEventOption, ...remainingEventOptions] = availableEventOptions;
  const triggerParameterValues = input.triggerParameterValues ?? {};
  const firstConversationKeyOptions =
    firstEventOption === undefined
      ? []
      : resolveContextualConversationKeyOptions({
          eventOption: firstEventOption,
          triggerParameterValues,
        });

  return firstConversationKeyOptions.filter((conversationKeyOption) =>
    remainingEventOptions.every((eventOption) =>
      resolveContextualConversationKeyOptions({
        eventOption,
        triggerParameterValues,
      }).some(
        (candidateOption) =>
          candidateOption.id === conversationKeyOption.id &&
          candidateOption.label === conversationKeyOption.label &&
          candidateOption.description === conversationKeyOption.description &&
          candidateOption.template === conversationKeyOption.template,
      ),
    ),
  );
}
