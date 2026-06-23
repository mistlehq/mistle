import {
  AssociatedProviderResourceKinds,
  AssociatedResourceEventTypes,
  type AssociatedResourceEventType,
  type AssociatedResourceProviderActor,
  type AssociatedResourceSelfAuthorshipInput,
  type IntegrationAssociatedResourceEventDefinition,
  type IntegrationAssociatedResourceEventsCapability,
  type IntegrationWebhookEventDefinition,
  type IntegrationWebhookEventParameterDefinition,
} from "@mistle/integrations-core";
import { z } from "zod";

import { SlackConnectionConfigSchema, type SlackConnectionConfig } from "./auth.js";
import { SlackThreadRootTimestampField } from "./normalized-event-fields.js";
import {
  createSlackThreadProviderResourceId,
  observeSlackRoutableResourceFromEgressResponse,
} from "./provider-resource-associations.js";
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
  resourceKind: "slack.thread";
  text: string;
};

export const SlackAssociatedResourceEventsCapability: IntegrationAssociatedResourceEventsCapability<SlackConnectionConfig> =
  {
    supportedEvents: createSlackAssociatedResourceEventDefinitions(),
    defaultRoutingResources: (input) => {
      if (!hasKnownSlackBotUserId(input.connection.config?.bot_user_id)) {
        return [];
      }

      return [
        {
          resourceKind: AssociatedProviderResourceKinds.SLACK_THREAD,
          eventTypes: [AssociatedResourceEventTypes.SLACK_THREAD_MESSAGE_CREATED],
        },
      ];
    },
    supportsResourceRegistration: (input) => {
      if (input.resourceKind !== AssociatedProviderResourceKinds.SLACK_THREAD) {
        return true;
      }

      const parsedConnectionConfig = SlackConnectionConfigSchema.safeParse(input.connection.config);
      return (
        parsedConnectionConfig.success &&
        hasKnownSlackBotUserId(parsedConnectionConfig.data.bot_user_id)
      );
    },
    supportsRoutingEvent: (input) => {
      if (input.resource.messageMode === "app_mentions_only") {
        return input.sourceWebhookEventType === "slack:app_mention";
      }

      return true;
    },
    observeEgressResponse: observeSlackRoutableResourceFromEgressResponse,
    observeWebhookEvent: observeSlackAssociatedResourceFromWebhookEvent,
    isSelfAuthoredEvent: isSelfAuthoredSlackAssociatedResourceEvent,
  };

function createSlackAssociatedResourceEventDefinitions(): IntegrationAssociatedResourceEventDefinition[] {
  const messageEventDefinition = findRequiredSlackWebhookEventDefinition("slack:message");
  const appMentionEventDefinition = findRequiredSlackWebhookEventDefinition("slack:app_mention");
  const parameters = mergeSlackThreadReplyParameters([
    messageEventDefinition,
    appMentionEventDefinition,
  ]);

  return [
    {
      resourceKind: AssociatedProviderResourceKinds.SLACK_THREAD,
      eventType: AssociatedResourceEventTypes.SLACK_THREAD_MESSAGE_CREATED,
      displayName: "Thread messages",
      ...(parameters.length === 0 ? {} : { parameters }),
      ...(messageEventDefinition.parameterGroups === undefined
        ? {}
        : { parameterGroups: messageEventDefinition.parameterGroups }),
    },
  ];
}

function findRequiredSlackWebhookEventDefinition(
  eventType: string,
): IntegrationWebhookEventDefinition {
  const eventDefinition = SlackSupportedWebhookEvents.find(
    (candidate) => candidate.eventType === eventType,
  );
  if (eventDefinition === undefined) {
    throw new Error(
      `Slack ${eventType} webhook event definition is required for thread message filters.`,
    );
  }
  return eventDefinition;
}

function mergeSlackThreadReplyParameters(
  eventDefinitions: readonly IntegrationWebhookEventDefinition[],
): IntegrationWebhookEventParameterDefinition[] {
  const parameters: IntegrationWebhookEventParameterDefinition[] = [];
  const seenParameterIds = new Set<string>();

  for (const eventDefinition of eventDefinitions) {
    for (const parameter of eventDefinition.parameters ?? []) {
      if (
        parameter.id === "threadReply" ||
        parameter.id === "userMention" ||
        parameter.id === "userGroupMention"
      ) {
        continue;
      }
      if (seenParameterIds.has(parameter.id)) {
        continue;
      }
      seenParameterIds.add(parameter.id);
      parameters.push(parameter);
    }
  }

  return parameters;
}

export function observeSlackAssociatedResourceFromWebhookEvent(input: {
  eventType: string;
  payload: Record<string, unknown>;
}): {
  actor?: AssociatedResourceProviderActor | undefined;
  eventType: AssociatedResourceEventType;
  providerResourceId: string;
  renderedInput: SlackThreadAssociatedResourceRenderedInput;
  resourceKind: "slack.thread";
} | null {
  if (input.eventType !== "slack:message" && input.eventType !== "slack:app_mention") {
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
  if (
    !parsedConnectionConfig.success ||
    !hasKnownSlackBotUserId(parsedConnectionConfig.data.bot_user_id)
  ) {
    return false;
  }

  return input.observation.actor?.providerSubjectId === parsedConnectionConfig.data.bot_user_id;
}

function hasKnownSlackBotUserId(botUserId: unknown): botUserId is string {
  return typeof botUserId === "string" && botUserId.trim().length > 0;
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
