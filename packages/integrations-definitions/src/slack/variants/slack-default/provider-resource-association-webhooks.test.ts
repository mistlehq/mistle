import {
  AssociatedProviderResourceKinds,
  AssociatedResourceEventTypes,
} from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import {
  isSelfAuthoredSlackAssociatedResourceEvent,
  SlackAssociatedResourceEventsCapability,
  observeSlackAssociatedResourceFromWebhookEvent,
} from "./provider-resource-association-webhooks.js";

describe("SlackAssociatedResourceEventsCapability", () => {
  it("advertises filters that can match thread reply events", () => {
    expect(SlackAssociatedResourceEventsCapability.supportedEvents).toEqual([
      {
        resourceKind: AssociatedProviderResourceKinds.SLACK_THREAD,
        eventType: AssociatedResourceEventTypes.SLACK_THREAD_MESSAGE_CREATED,
        displayName: "Thread messages",
        parameters: [
          {
            id: "invocationToken",
            label: "invocation token",
            kind: "string",
            payloadPath: ["event", "text"],
            matchMode: "contains_token",
            controlVariant: "invocation-token",
          },
          {
            id: "channel",
            label: "channel",
            kind: "resource-select",
            resourceKind: "channel",
            payloadPath: ["event", "channel"],
            prefix: "in",
            multiValue: true,
          },
          {
            id: "sender",
            label: "sender",
            kind: "resource-select",
            resourceKind: "user",
            payloadPath: ["event", "user"],
            multiValue: true,
            prefix: "from",
            placeholder: "Any sender",
          },
          {
            id: "messageText",
            label: "message text",
            kind: "string",
            payloadPath: ["event", "text"],
            matchMode: "contains",
            prefix: "containing",
            placeholder: "deployment failed",
          },
        ],
      },
    ]);
  });
});

describe("observeSlackAssociatedResourceFromWebhookEvent", () => {
  it("observes Slack thread replies as associated resource events", () => {
    expect(
      observeSlackAssociatedResourceFromWebhookEvent({
        eventType: "slack:message",
        payload: {
          event: {
            channel: "C123",
            ts: "1710000001.000200",
            thread_ts: "1710000000.000100",
            mistle_thread_root_ts: "1710000000.000100",
            user: "U456",
            text: "Can you also check the failing deploy logs?",
          },
        },
      }),
    ).toEqual({
      actor: {
        providerSubjectId: "U456",
      },
      eventType: AssociatedResourceEventTypes.SLACK_THREAD_MESSAGE_CREATED,
      providerResourceId: "C123:1710000000.000100",
      resourceKind: AssociatedProviderResourceKinds.SLACK_THREAD,
      renderedInput: {
        kind: "slack.thread.associated_resource_event",
        eventType: AssociatedResourceEventTypes.SLACK_THREAD_MESSAGE_CREATED,
        providerResourceId: "C123:1710000000.000100",
        resourceKind: AssociatedProviderResourceKinds.SLACK_THREAD,
        text: [
          "Slack channel: C123",
          "Thread root: 1710000000.000100",
          "Event type: slack.thread.message.created",
          "Author: U456",
          "",
          "Thread reply:",
          "Message text: Can you also check the failing deploy logs?",
        ].join("\n"),
      },
    });
  });

  it("observes threaded Slack app mentions as associated resource events", () => {
    expect(
      observeSlackAssociatedResourceFromWebhookEvent({
        eventType: "slack:app_mention",
        payload: {
          event: {
            channel: "C123",
            ts: "1710000002.000300",
            thread_ts: "1710000000.000100",
            mistle_thread_root_ts: "1710000000.000100",
            user: "U456",
            text: "<@U_BOT> can you re-check this?",
          },
        },
      }),
    ).toEqual({
      actor: {
        providerSubjectId: "U456",
      },
      eventType: AssociatedResourceEventTypes.SLACK_THREAD_MESSAGE_CREATED,
      providerResourceId: "C123:1710000000.000100",
      resourceKind: AssociatedProviderResourceKinds.SLACK_THREAD,
      renderedInput: {
        kind: "slack.thread.associated_resource_event",
        eventType: AssociatedResourceEventTypes.SLACK_THREAD_MESSAGE_CREATED,
        providerResourceId: "C123:1710000000.000100",
        resourceKind: AssociatedProviderResourceKinds.SLACK_THREAD,
        text: [
          "Slack channel: C123",
          "Thread root: 1710000000.000100",
          "Event type: slack.thread.message.created",
          "Author: U456",
          "",
          "Thread reply:",
          "Message text: <@U_BOT> can you re-check this?",
        ].join("\n"),
      },
    });
  });

  it("does not observe top-level Slack app mentions as associated resource events", () => {
    expect(
      observeSlackAssociatedResourceFromWebhookEvent({
        eventType: "slack:app_mention",
        payload: {
          event: {
            channel: "C123",
            ts: "1710000000.000100",
            thread_ts: "1710000000.000100",
            mistle_thread_root_ts: "1710000000.000100",
            user: "U456",
            text: "<@U_BOT> please start a new thread",
          },
        },
      }),
    ).toBeNull();
  });

  it("does not observe Slack top-level messages as associated resource events", () => {
    expect(
      observeSlackAssociatedResourceFromWebhookEvent({
        eventType: "slack:message",
        payload: {
          event: {
            channel: "C123",
            ts: "1710000000.000100",
            thread_ts: "1710000000.000100",
            mistle_thread_root_ts: "1710000000.000100",
            user: "U456",
            text: "A new top-level message.",
          },
        },
      }),
    ).toBeNull();
  });
});

describe("isSelfAuthoredSlackAssociatedResourceEvent", () => {
  it("suppresses events authored by the integration bot user", () => {
    expect(
      isSelfAuthoredSlackAssociatedResourceEvent({
        connection: {
          id: "icn_slack",
          config: {
            connection_method: "slack-bot-token",
            bot_user_id: "U_BOT",
          },
        },
        observation: {
          actor: {
            providerSubjectId: "U_BOT",
          },
          eventType: AssociatedResourceEventTypes.SLACK_THREAD_MESSAGE_CREATED,
          providerResourceId: "C123:1710000000.000100",
          resourceKind: AssociatedProviderResourceKinds.SLACK_THREAD,
          renderedInput: {
            text: "Slack channel: C123",
          },
        },
      }),
    ).toBe(true);
  });

  it("does not suppress linked human-authored events", () => {
    expect(
      isSelfAuthoredSlackAssociatedResourceEvent({
        connection: {
          id: "icn_slack",
          config: {
            connection_method: "slack-bot-token",
            bot_user_id: "U_BOT",
          },
        },
        observation: {
          actor: {
            providerSubjectId: "U_HUMAN",
          },
          eventType: AssociatedResourceEventTypes.SLACK_THREAD_MESSAGE_CREATED,
          providerResourceId: "C123:1710000000.000100",
          resourceKind: AssociatedProviderResourceKinds.SLACK_THREAD,
          renderedInput: {
            text: "Slack channel: C123",
          },
        },
      }),
    ).toBe(false);
  });
});
