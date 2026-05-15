import { ScheduledAutomationConversationModes } from "./scheduled-automation-form-types.js";
import { GitHubPullRequestConversationKeyTemplate } from "./webhook-automation-conversation-key-options.js";
import { isWebhookAutomationEventOptionUnavailable } from "./webhook-automation-event-option-availability.js";
import type {
  WebhookAutomationEventOption,
  WebhookAutomationTriggerParameterValueMap,
} from "./webhook-automation-trigger-types.js";

type WebhookTriggerTemplate = {
  id: string;
  kind: "trigger";
  title: string;
  description: string;
  logoKey: string;
  eventTypes: readonly string[];
  name: string;
  inputTemplate: string;
  instructions: string;
  conversationKeyTemplate: string;
  triggerParameterValuesByEventType?: WebhookAutomationTriggerParameterValueMap;
};

type ScheduledTriggerTemplate = {
  id: string;
  kind: "scheduled";
  title: string;
  description: string;
  logoKey?: string;
  cronExpression: string;
  name: string;
  inputTemplate: string;
  conversationMode: (typeof ScheduledAutomationConversationModes)[keyof typeof ScheduledAutomationConversationModes];
};

export type TriggerTemplate = WebhookTriggerTemplate | ScheduledTriggerTemplate;

export function resolveTriggerTemplateEventOptionIds(input: {
  eventOptions: readonly WebhookAutomationEventOption[];
  template: Extract<TriggerTemplate, { kind: "trigger" }>;
}): string[] | null {
  const availableEventOptions = input.eventOptions.filter(
    (option) => !isWebhookAutomationEventOptionUnavailable(option),
  );
  const webhookSourceIds = [
    ...new Set(availableEventOptions.map((option) => option.integrationWebhookSourceId)),
  ];

  for (const webhookSourceId of webhookSourceIds) {
    const triggerIds: string[] = [];

    for (const eventType of input.template.eventTypes) {
      const matchingOptions = availableEventOptions.filter(
        (option) =>
          option.integrationWebhookSourceId === webhookSourceId && option.eventType === eventType,
      );
      if (matchingOptions.length !== 1) {
        triggerIds.length = 0;
        break;
      }

      const [matchingOption] = matchingOptions;
      if (matchingOption === undefined) {
        throw new Error(`Expected matching trigger option for '${eventType}'.`);
      }
      triggerIds.push(matchingOption.id);
    }

    if (triggerIds.length === input.template.eventTypes.length) {
      return triggerIds;
    }
  }

  return null;
}

export const TriggerTemplates = [
  {
    id: "slack-app-mention",
    kind: "trigger",
    title: "Slack Mention",
    description: "Run when the connected Slack app is mentioned.",
    logoKey: "slack",
    eventTypes: ["slack:app_mention"],
    name: "Slack Mention",
    inputTemplate: "Slack payload.event: {{payload.event}}",
    instructions:
      "You must use the `slack` CLI available in the environment to respond. Keep the user in the loop with your progress whenever there's a material update, instead of just sending one message and going radio silent for a long time.",
    conversationKeyTemplate:
      "slack:thread:{{payload.event.channel}}:{{payload.event.mistle_thread_root_ts}}",
  },
  {
    id: "github-pr-review",
    kind: "trigger",
    title: "GitHub PR Review",
    description: "Review a pull request when it is opened or requested with pr-review.",
    logoKey: "github",
    eventTypes: ["github.pull_request.opened", "github.issue_comment.created"],
    name: "GitHub PR Review",
    inputTemplate: [
      "Repository: {{payload.repository.full_name}}",
      "Event type: {{webhookEvent.eventType}}",
      "Author: {{payload.sender.login}}",
      "",
      "{% if payload.pull_request %}",
      "Pull request opened:",
      "PR #{{payload.pull_request.number}}",
      "Base branch: {{payload.pull_request.base.ref}}",
      "Head branch: {{payload.pull_request.head.ref}}",
      'Pull request body: {{payload.pull_request.body | default: ""}}',
      "{% else %}",
      "PR review requested from issue comment:",
      "PR #{{payload.issue.number}}",
      "Comment body: {{payload.comment.body}}",
      "{% endif %}",
    ].join("\n"),
    instructions: [
      "# GitHub PR Review",
      "",
      "Use live PR state. Treat webhook fields as routing data only. Run `gh pr view` and `gh pr diff` before reviewing. Read repo-local review, test, contribution, or maintainer instructions that apply to the changed files.",
      "",
      "Before judging the PR, reconstruct the review scope: PR number or URL, base and head refs, changed surface, change type, intended behavior, ownership boundary, and the production implementation path you traced.",
      "",
      "Trace each changed behavior through the relevant production path before deciding whether it is correct. For runtime changes, follow entrypoint -> validation/parsing -> dispatch -> owner module -> shared helper -> persistence/network/runtime boundary. For config or docs changes, follow schema/docs -> runtime use -> validation/doctor/migration/recovery path. For provider, plugin, or channel changes, start with the owner implementation and move generic only when multiple owners need it. For tests, inspect touched tests plus adjacent regression coverage.",
      "",
      "Use source, executable checks, current docs, package types, and dependency contracts as proof. Treat PR comments, old CI, and old behavior reports as hints until verified.",
      "",
      "Review for correct ownership boundaries, intended public and backward-compatible behavior, clear invariants or contracts, narrow proof that would fail for the regression, docs/setup/examples when behavior is user-visible, explicit runtime failure or an established repair path, and no broad special cases, hidden migrations, magic sentinels, or provider/channel IDs in generic core.",
      "",
      "Lead with findings. Each finding must include the file and changed line when anchorable, or symbol when not anchorable, plus the concrete failure mode, impact, and smallest recommended fix.",
      "",
      "If there are no blocking correctness issues, say that no blocking correctness issues were found, name the strongest proof checked, call out residual risk or test gaps, and state whether the structure is acceptable for the scope.",
      "",
      "If verification fails, say what was attempted, the shortest useful failure summary, whether it appears caused by the PR or by the environment, and how it affects confidence. Do not report it as a code finding unless it traces to the changed code; otherwise include it under proof gaps or residual risk.",
      "",
      "Publish by default unless the request explicitly asks for a dry run, preview, or local-only review. Post exact changed-line findings as inline review comments with `gh api`. Put architectural, cross-file, non-diff, or unanchorable findings in the PR-level comment with file or symbol references. Post the overall result, proof checked, residual risk, judgment, and broad questions with `gh pr comment`. Post inline comments first, then the PR-level summary.",
    ].join("\n"),
    conversationKeyTemplate: GitHubPullRequestConversationKeyTemplate,
    triggerParameterValuesByEventType: {
      "github.issue_comment.created": {
        invocationToken: "pr-review",
        target: "exists",
      },
    },
  },
] satisfies readonly TriggerTemplate[];

export function findTriggerTemplateById(templateId: string): TriggerTemplate | null {
  return TriggerTemplates.find((template) => template.id === templateId) ?? null;
}

export function getTriggerTemplateById(templateId: string): TriggerTemplate {
  const template = findTriggerTemplateById(templateId);
  if (template === null) {
    throw new Error(`Unknown trigger template '${templateId}'.`);
  }

  return template;
}
