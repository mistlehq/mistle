import type { WebhookAutomationEventOption } from "./webhook-automation-trigger-types.js";

export const AgentInstructionTokenGroups = {
  PAYLOAD: "payload",
  WEBHOOK_EVENT: "webhookEvent",
  AUTOMATION_RUN: "automationRun",
} as const;

export type AgentInstructionTokenGroup =
  (typeof AgentInstructionTokenGroups)[keyof typeof AgentInstructionTokenGroups];

export type AgentInstructionsEditorToken = {
  path: string;
  insertText: string;
  label: string;
  group: AgentInstructionTokenGroup;
  description?: string;
  sourceEventType?: string;
  replacePath: string;
};

export const AgentInstructionsNoTriggerHelpText =
  "Select a trigger to unlock event-specific payload fields.";

const SharedAgentInstructionTokens: readonly AgentInstructionsEditorToken[] = [
  createSharedToken({
    path: "webhookEvent.eventType",
    label: "Event type",
    group: AgentInstructionTokenGroups.WEBHOOK_EVENT,
    description: "The normalized event type for the webhook event.",
  }),
  createSharedToken({
    path: "webhookEvent.id",
    label: "Webhook event id",
    group: AgentInstructionTokenGroups.WEBHOOK_EVENT,
    description: "The internal webhook event id.",
  }),
  createSharedToken({
    path: "webhookEvent.providerEventType",
    label: "Provider event type",
    group: AgentInstructionTokenGroups.WEBHOOK_EVENT,
    description: "The upstream provider event type.",
  }),
  createSharedToken({
    path: "webhookEvent.externalEventId",
    label: "External event id",
    group: AgentInstructionTokenGroups.WEBHOOK_EVENT,
    description: "The upstream event identifier when available.",
  }),
  createSharedToken({
    path: "webhookEvent.externalDeliveryId",
    label: "External delivery id",
    group: AgentInstructionTokenGroups.WEBHOOK_EVENT,
    description: "The upstream delivery identifier when available.",
  }),
  createSharedToken({
    path: "automationRun.id",
    label: "Automation run id",
    group: AgentInstructionTokenGroups.AUTOMATION_RUN,
    description: "The current automation run id.",
  }),
  createSharedToken({
    path: "automationRun.automationTargetId",
    label: "Automation target id",
    group: AgentInstructionTokenGroups.AUTOMATION_RUN,
    description: "The selected automation target id.",
  }),
  createSharedToken({
    path: "payload",
    label: "Payload",
    group: AgentInstructionTokenGroups.PAYLOAD,
    description: "The full webhook payload object.",
  }),
] as const;

function createSharedToken(input: {
  path: string;
  label: string;
  group: AgentInstructionTokenGroup;
  description: string;
}): AgentInstructionsEditorToken {
  return {
    path: input.path,
    insertText: `{{${input.path}}}`,
    label: input.label,
    group: input.group,
    description: input.description,
    replacePath: input.path,
  };
}

function createPayloadToken(input: {
  path: string;
  description: string;
  sourceEventType: string;
}): AgentInstructionsEditorToken {
  return {
    path: input.path,
    insertText: `{{${input.path}}}`,
    label: input.path,
    group: AgentInstructionTokenGroups.PAYLOAD,
    description: input.description,
    sourceEventType: input.sourceEventType,
    replacePath: input.path,
  };
}

function compareTokenGroups(
  left: AgentInstructionTokenGroup,
  right: AgentInstructionTokenGroup,
): number {
  const order: Record<AgentInstructionTokenGroup, number> = {
    [AgentInstructionTokenGroups.WEBHOOK_EVENT]: 0,
    [AgentInstructionTokenGroups.AUTOMATION_RUN]: 1,
    [AgentInstructionTokenGroups.PAYLOAD]: 2,
  };

  return order[left] - order[right];
}

export function buildAgentInstructionTokenCatalog(input: {
  selectedEventOptions: readonly WebhookAutomationEventOption[];
}): readonly AgentInstructionsEditorToken[] {
  const tokensByPath = new Map<string, AgentInstructionsEditorToken>();

  for (const token of SharedAgentInstructionTokens) {
    tokensByPath.set(token.path, token);
  }

  for (const eventOption of input.selectedEventOptions) {
    for (const payloadReference of eventOption.payloadReferences ?? []) {
      const path = `payload.${payloadReference.path.join(".")}`;
      const nextToken = createPayloadToken({
        path,
        description: payloadReference.description,
        sourceEventType: eventOption.eventType,
      });

      if (!tokensByPath.has(path)) {
        tokensByPath.set(path, nextToken);
      }
    }
  }

  return [...tokensByPath.values()].sort((left, right) => {
    const groupComparison = compareTokenGroups(left.group, right.group);
    if (groupComparison !== 0) {
      return groupComparison;
    }

    const leftTopLevel = !left.path.includes(".");
    const rightTopLevel = !right.path.includes(".");
    if (leftTopLevel !== rightTopLevel) {
      return leftTopLevel ? -1 : 1;
    }

    const labelComparison = left.label.localeCompare(right.label);
    if (labelComparison !== 0) {
      return labelComparison;
    }

    return left.path.localeCompare(right.path);
  });
}
