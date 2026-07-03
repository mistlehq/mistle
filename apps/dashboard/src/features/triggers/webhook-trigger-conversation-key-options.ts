import { isWebhookTriggerEventOptionUnavailable } from "./webhook-trigger-event-option-availability.js";
import type {
  WebhookTriggerConversationKeyOption,
  WebhookTriggerEventOption,
  WebhookTriggerEventParameterRuleMap,
} from "./webhook-trigger-event-types.js";
import { WebhookTriggerEventParameterRuleOperators } from "./webhook-trigger-event-types.js";

const GitHubIssueCommentCreatedEventType = "github.issue_comment.created";
const GitHubIssueCommentTargetParameterId = "target";
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

  return firstConversationKeyOptions.filter((conversationKeyOption) =>
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
}
