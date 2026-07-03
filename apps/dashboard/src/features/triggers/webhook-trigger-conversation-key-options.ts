import { isWebhookTriggerEventOptionUnavailable } from "./webhook-trigger-event-option-availability.js";
import type {
  WebhookTriggerConversationKeyOption,
  WebhookTriggerEventOption,
  WebhookTriggerEventParameterRuleMap,
} from "./webhook-trigger-event-types.js";
import { WebhookTriggerEventParameterRuleOperators } from "./webhook-trigger-event-types.js";

const GitHubIssueCommentCreatedEventType = "github.issue_comment.created";
const GitHubPullRequestOpenedEventType = "github.pull_request.opened";
const GitHubIssueCommentTargetParameterId = "target";
export const GitHubPullRequestConversationKeyTemplate =
  "{{payload.repository.full_name}}:pull-request:{{payload.pull_request.number}}";
export const GitHubPullRequestReviewConversationKeyTemplate =
  '{{payload.repository.full_name}}:pull-request:{% if webhookEvent.eventType == "github.pull_request.opened" %}{{payload.pull_request.number}}{% else %}{{payload.issue.number}}{% endif %}';

const GitHubPullRequestConversationKeyOption = {
  id: "pull-request",
  label: "Pull request",
  description: "Events from the same pull request go to the same conversation.",
  template: GitHubPullRequestReviewConversationKeyTemplate,
} satisfies WebhookTriggerConversationKeyOption;

function shouldAddGitHubPullRequestGrouping(input: {
  eventOption: WebhookTriggerEventOption;
  eventParameterRules: WebhookTriggerEventParameterRuleMap;
}): boolean {
  if (input.eventOption.eventType !== GitHubIssueCommentCreatedEventType) {
    return false;
  }

  const targetRule =
    input.eventParameterRules[input.eventOption.id]?.[GitHubIssueCommentTargetParameterId];

  return (
    targetRule?.operator === WebhookTriggerEventParameterRuleOperators.EXISTS &&
    targetRule.value === WebhookTriggerEventParameterRuleOperators.EXISTS
  );
}

function resolveContextualConversationKeyOptions(input: {
  eventOption: WebhookTriggerEventOption;
  eventParameterRules: WebhookTriggerEventParameterRuleMap;
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
  eventParameterRules?: WebhookTriggerEventParameterRuleMap;
}): readonly WebhookTriggerConversationKeyOption[] {
  const availableEventOptions = input.selectedEventOptions.filter(
    (eventOption) => !isWebhookTriggerEventOptionUnavailable(eventOption),
  );

  if (availableEventOptions.length === 0) {
    return [];
  }

  const [firstEventOption, ...remainingEventOptions] = availableEventOptions;
  const eventParameterRules = input.eventParameterRules ?? {};
  const firstConversationKeyOptions =
    firstEventOption === undefined
      ? []
      : resolveContextualConversationKeyOptions({
          eventOption: firstEventOption,
          eventParameterRules,
        });

  const commonConversationKeyOptions = firstConversationKeyOptions.filter((conversationKeyOption) =>
    remainingEventOptions.every((eventOption) =>
      resolveContextualConversationKeyOptions({
        eventOption,
        eventParameterRules,
      }).some(
        (candidateOption) =>
          candidateOption.id === conversationKeyOption.id &&
          candidateOption.label === conversationKeyOption.label &&
          candidateOption.description === conversationKeyOption.description &&
          candidateOption.template === conversationKeyOption.template,
      ),
    ),
  );

  const githubPullRequestReviewConversationKeyOption =
    resolveGitHubPullRequestReviewConversationKeyOption({
      selectedEventOptions: availableEventOptions,
      eventParameterRules,
    });

  if (githubPullRequestReviewConversationKeyOption === null) {
    return commonConversationKeyOptions;
  }

  return [
    githubPullRequestReviewConversationKeyOption,
    ...commonConversationKeyOptions.filter(
      (conversationKeyOption) =>
        conversationKeyOption.id !== githubPullRequestReviewConversationKeyOption.id,
    ),
  ];
}

function resolveGitHubPullRequestReviewConversationKeyOption(input: {
  selectedEventOptions: readonly WebhookTriggerEventOption[];
  eventParameterRules: WebhookTriggerEventParameterRuleMap;
}): WebhookTriggerConversationKeyOption | null {
  const hasPullRequestOpenedEvent = input.selectedEventOptions.some(
    (eventOption) =>
      eventOption.eventType === GitHubPullRequestOpenedEventType &&
      eventOption.conversationKeyOptions?.some(
        (conversationKeyOption) =>
          conversationKeyOption.id === GitHubPullRequestConversationKeyOption.id,
      ) === true,
  );
  const hasIssueCommentPullRequestTargetEvent = input.selectedEventOptions.some((eventOption) =>
    shouldAddGitHubPullRequestGrouping({
      eventOption,
      eventParameterRules: input.eventParameterRules,
    }),
  );
  const allSelectedEventsAreHandled = input.selectedEventOptions.every(
    (eventOption) =>
      eventOption.eventType === GitHubPullRequestOpenedEventType ||
      shouldAddGitHubPullRequestGrouping({
        eventOption,
        eventParameterRules: input.eventParameterRules,
      }),
  );

  return hasPullRequestOpenedEvent &&
    hasIssueCommentPullRequestTargetEvent &&
    allSelectedEventsAreHandled
    ? GitHubPullRequestConversationKeyOption
    : null;
}
