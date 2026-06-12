import {
  AssociatedProviderResourceKinds,
  AssociatedResourceEventTypes,
  type AssociatedProviderResourceKind,
  type AssociatedResourceEventType,
  type AssociatedResourceProviderActor,
  type AssociatedResourceSelfAuthorshipInput,
  type IntegrationAssociatedResourceEventDefinition,
  type IntegrationAssociatedResourceEventsCapability,
} from "@mistle/integrations-core";
import { z } from "zod";

import { SlackConnectionConfigSchema, type SlackConnectionConfig } from "./auth.js";
import { SlackThreadRootTimestampField } from "./normalized-event-fields.js";
import { createSlackThreadProviderResourceId } from "./provider-resource-associations.js";
import { SlackSupportedWebhookEvents } from "./supported-webhook-events.js";

const SlackThreadMessagePayloadSchema = z.looseObject({
  channel: z.string().min(1),
  text: z.string(),
  thread_ts: z.string().min(1),
  ts: z.string().min(1),
  user: z.string().min(1).optional(),
  [SlackThreadRootTimestampField]: z.string().min(1),
});

const SlackWebhookPayloadSchema = z.looseObject({
  event: SlackThreadMessagePayloadSchema,
});

export type SlackThreadAssociatedResourceRenderedInput = {
  kind: "slack.thread.associated_resource_event";
  eventType: AssociatedResourceEventType;
  providerResourceId: string;
  resourceKind: Extract<AssociatedProviderResourceKind, "slack.thread">;
  text: string;
};

export const SlackAssociatedResourceEventsCapability: IntegrationAssociatedResourceEventsCapability<SlackConnectionConfig> =
  {
    supportedEvents: createSlackAssociatedResourceEventDefinitions(),
    observeWebhookEvent: observeSlackAssociatedResourceFromWebhookEvent,
    isSelfAuthoredEvent: isSelfAuthoredSlackAssociatedResourceEvent,
  };

function createSlackAssociatedResourceEventDefinitions(): IntegrationAssociatedResourceEventDefinition[] {
  const messageEventDefinition = SlackSupportedWebhookEvents.find(
    (eventDefinition) => eventDefinition.eventType === "slack:message",
  );
  if (messageEventDefinition === undefined) {
    throw new Error("Slack message webhook event definition is required for thread reply filters.");
  }

  return [
    {
      resourceKind: AssociatedProviderResourceKinds.SLACK_THREAD,
      eventType: AssociatedResourceEventTypes.SLACK_THREAD_MESSAGE_CREATED,
      displayName: "Thread replies",
      ...(messageEventDefinition.parameters === undefined
        ? {}
        : { parameters: messageEventDefinition.parameters }),
      ...(messageEventDefinition.parameterGroups === undefined
        ? {}
        : { parameterGroups: messageEventDefinition.parameterGroups }),
    },
  ];
}

export function observeSlackAssociatedResourceFromWebhookEvent(input: {
  eventType: string;
  payload: Record<string, unknown>;
}): {
  actor?: AssociatedResourceProviderActor | undefined;
  eventType: AssociatedResourceEventType;
  providerResourceId: string;
  renderedInput: SlackThreadAssociatedResourceRenderedInput;
  resourceKind: Extract<AssociatedProviderResourceKind, "slack.thread">;
} | null {
  if (input.eventType !== "slack:message") {
    return null;
  }

  const parsedPayload = SlackWebhookPayloadSchema.safeParse(input.payload);
  if (
    !parsedPayload.success ||
    parsedPayload.data.event.ts === parsedPayload.data.event.thread_ts
  ) {
    return null;
  }

  const event = parsedPayload.data.event;
  const resourceKind = AssociatedProviderResourceKinds.SLACK_THREAD;
  const eventType = AssociatedResourceEventTypes.SLACK_THREAD_MESSAGE_CREATED;
  const providerResourceId = createSlackThreadProviderResourceId({
    channel: event.channel,
    threadRootTs: event[SlackThreadRootTimestampField],
  });
  const text = renderThreadMessageInput({
    author: event.user,
    channel: event.channel,
    eventType,
    messageText: event.text,
    threadRootTs: event[SlackThreadRootTimestampField],
  });

  return {
    ...(event.user === undefined ? {} : { actor: { providerSubjectId: event.user } }),
    eventType,
    providerResourceId,
    resourceKind,
    renderedInput: {
      kind: "slack.thread.associated_resource_event",
      eventType,
      providerResourceId,
      resourceKind,
      text,
    },
  };
}

export function isSelfAuthoredSlackAssociatedResourceEvent(
  input: AssociatedResourceSelfAuthorshipInput<SlackConnectionConfig>,
): boolean {
  const parsedConnectionConfig = SlackConnectionConfigSchema.safeParse(input.connection.config);
  if (!parsedConnectionConfig.success || parsedConnectionConfig.data.bot_user_id === undefined) {
    return false;
  }

  return input.observation.actor?.providerSubjectId === parsedConnectionConfig.data.bot_user_id;
}

function renderThreadMessageInput(input: {
  author?: string | undefined;
  channel: string;
  eventType: AssociatedResourceEventType;
  messageText: string;
  threadRootTs: string;
}): string {
  return renderLines([
    `Slack channel: ${input.channel}`,
    `Thread root: ${input.threadRootTs}`,
    `Event type: ${input.eventType}`,
    ...renderOptionalAuthor(input.author),
    "",
    "Thread reply:",
    `Message text: ${input.messageText}`,
  ]);
}

function renderOptionalAuthor(author: string | undefined): string[] {
  return author === undefined ? [] : [`Author: ${author}`];
}

function renderLines(lines: ReadonlyArray<string>): string {
  return lines.join("\n");
}
