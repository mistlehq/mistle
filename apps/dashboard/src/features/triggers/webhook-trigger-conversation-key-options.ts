import { isWebhookTriggerEventOptionUnavailable } from "./webhook-trigger-event-option-availability.js";
import type {
  WebhookTriggerConversationKeyOption,
  WebhookTriggerEventOption,
  WebhookTriggerEventParameterValueMap,
} from "./webhook-trigger-event-types.js";

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
} satisfies WebhookTriggerConversationKeyOption;

function shouldAddGitHubPullRequestGrouping(input: {
  eventOption: WebhookTriggerEventOption;
  eventParameterValues: WebhookTriggerEventParameterValueMap;
}): boolean {
  if (input.eventOption.eventType !== GitHubIssueCommentCreatedEventType) {
    return false;
  }

  return (
    input.eventParameterValues[input.eventOption.id]?.[GitHubIssueCommentTargetParameterId] ===
    GitHubIssueCommentPullRequestTargetValue
  );
}

function resolveContextualConversationKeyOptions(input: {
  eventOption: WebhookTriggerEventOption;
  eventParameterValues: WebhookTriggerEventParameterValueMap;
}): readonly WebhookTriggerConversationKeyOption[] {
  const options = input.eventOption.conversationKeyOptions ?? [];
  if (
    !shouldAddGitHubPullRequestGrouping(input) ||
    options.some((option) => option.id === GitHubPullRequestConversationKeyOption.id)
  ) {
    return options;
  }

  return [...options, GitHubPullRequestConversationKeyOption];
}

export function resolveCommonWebhookTriggerConversationKeyOptions(input: {
  selectedEventOptions: readonly WebhookTriggerEventOption[];
  eventParameterValues?: WebhookTriggerEventParameterValueMap;
}): readonly WebhookTriggerConversationKeyOption[] {
  const availableEventOptions = input.selectedEventOptions.filter(
    (eventOption) => !isWebhookTriggerEventOptionUnavailable(eventOption),
  );

  if (availableEventOptions.length === 0) {
    return [];
  }

  const [firstEventOption, ...remainingEventOptions] = availableEventOptions;
  const eventParameterValues = input.eventParameterValues ?? {};
  const firstConversationKeyOptions =
    firstEventOption === undefined
      ? []
      : resolveContextualConversationKeyOptions({
          eventOption: firstEventOption,
          eventParameterValues,
        });

  return firstConversationKeyOptions.filter((conversationKeyOption) =>
    remainingEventOptions.every((eventOption) =>
      resolveContextualConversationKeyOptions({
        eventOption,
        eventParameterValues,
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
