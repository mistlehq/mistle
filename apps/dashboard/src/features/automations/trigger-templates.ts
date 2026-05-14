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
