import { BadRequestError } from "@mistle/http/errors.js";
import {
  WebhookTriggerTemplateKinds,
  WebhookTriggerTemplateValidationError,
  assertWebhookTriggerTemplatesValid,
  formatWebhookTriggerTemplateValidationIssues,
  type IntegrationWebhookEventDefinition,
  type WebhookTriggerTemplateInput,
  type WebhookTriggerTemplateValidationIssue,
} from "@mistle/integrations-core";

import { TriggerWebhooksBadRequestCodes } from "../constants.js";

export function assertWebhookTriggerTemplatesOrThrow(input: {
  eventTypes: readonly string[];
  inputTemplate: string;
  conversationKeyTemplate: string;
  idempotencyKeyTemplate: string | null;
  supportedWebhookEvents: readonly IntegrationWebhookEventDefinition[];
}): void {
  const selectedEvents = resolveSelectedEvents({
    eventTypes: input.eventTypes,
    supportedWebhookEvents: input.supportedWebhookEvents,
  });
  const templates: WebhookTriggerTemplateInput[] = [
    {
      field: "inputTemplate",
      template: input.inputTemplate,
      kind: WebhookTriggerTemplateKinds.INPUT,
    },
    {
      field: "conversationKeyTemplate",
      template: input.conversationKeyTemplate,
      kind: WebhookTriggerTemplateKinds.KEY,
    },
  ];

  if (input.idempotencyKeyTemplate !== null) {
    templates.push({
      field: "idempotencyKeyTemplate",
      template: input.idempotencyKeyTemplate,
      kind: WebhookTriggerTemplateKinds.KEY,
    });
  }

  try {
    assertWebhookTriggerTemplatesValid({
      selectedEvents,
      templates,
    });
  } catch (error) {
    if (!(error instanceof WebhookTriggerTemplateValidationError)) {
      throw error;
    }

    throw new BadRequestError(
      TriggerWebhooksBadRequestCodes.INVALID_WEBHOOK_TRIGGER_TEMPLATE_REFERENCES,
      `Webhook trigger templates contain invalid trigger event field references. ${readTemplateValidationMessage(
        error.issues,
      )}`,
    );
  }
}

function resolveSelectedEvents(input: {
  eventTypes: readonly string[];
  supportedWebhookEvents: readonly IntegrationWebhookEventDefinition[];
}): readonly IntegrationWebhookEventDefinition[] {
  return input.eventTypes.flatMap((eventType) =>
    input.supportedWebhookEvents.filter(
      (eventDefinition) => eventDefinition.eventType === eventType,
    ),
  );
}

function readTemplateValidationMessage(
  issues: readonly WebhookTriggerTemplateValidationIssue[],
): string {
  return formatWebhookTriggerTemplateValidationIssues(issues);
}
