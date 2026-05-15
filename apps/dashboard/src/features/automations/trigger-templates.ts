import { ScheduledAutomationConversationModes } from "./scheduled-automation-form-types.js";

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
  triggerParameterValuesByEventType?: Record<string, Record<string, string>>;
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
      "PR #{{payload.pull_request.number | default: payload.issue.number}}",
      "Event type: {{webhookEvent.eventType}}",
      'Base branch: {{payload.pull_request.base.ref | default: ""}}',
      'Head branch: {{payload.pull_request.head.ref | default: ""}}',
      "Author: {{payload.sender.login}}",
      'Comment body: {{payload.comment.body | default: ""}}',
      'Pull request body: {{payload.pull_request.body | default: ""}}',
    ].join("\n"),
    instructions: [
      "Use the `gh` CLI. Treat the webhook fields as routing data only.",
      "Before reviewing, fetch the current pull request state with `gh pr view` and inspect the diff with `gh pr diff`.",
      "Review the pull request for correctness, regressions, security issues, and missing tests.",
      "Use `gh pr comment` to add a normal pull request comment.",
      "Use `gh pr review` to submit a top-level review.",
      "For inline file review comments, use `gh api` against the pull request review comment or review endpoints after identifying the file path, line, side, and current head commit.",
    ].join(" "),
    conversationKeyTemplate:
      "{{payload.repository.full_name}}:pull-request:{{payload.pull_request.number | default: payload.issue.number}}",
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
