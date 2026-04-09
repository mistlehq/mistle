import { SlackBrowserDefinition } from "@mistle/integrations-definitions/browser";
import { describe, expect, it } from "vitest";

import { resolveCommonWebhookAutomationConversationKeyOptions } from "./webhook-automation-conversation-key-options.js";
import { createWebhookAutomationEventOption } from "./webhook-automation-option-builders.js";

const SlackWebhookSourceId = "iws_slack";
const SlackConnectionId = "icn_slack";

function createSlackEventOption(eventType: string) {
  const eventDefinition = SlackBrowserDefinition.supportedWebhookEvents?.find(
    (candidate) => candidate.eventType === eventType,
  );
  if (eventDefinition === undefined) {
    throw new Error(`Missing Slack event definition for '${eventType}'.`);
  }

  return createWebhookAutomationEventOption({
    eventDefinition,
    webhookSourceId: SlackWebhookSourceId,
    connectionId: SlackConnectionId,
    connectionLabel: "Slack Engineering",
    logoKey: "slack",
  });
}

describe("resolveCommonWebhookAutomationConversationKeyOptions", () => {
  it("keeps Slack thread grouping available across message and reaction triggers", () => {
    const options = resolveCommonWebhookAutomationConversationKeyOptions({
      selectedEventOptions: [
        createSlackEventOption("slack:message"),
        createSlackEventOption("slack:reaction_added"),
        createSlackEventOption("slack:reaction_removed"),
      ],
    });

    expect(options).toEqual([
      {
        id: "channel",
        label: "Channel",
        description: "Events from the same Slack channel go to the same conversation.",
        template: "slack:channel:{{payload.event.channel}}",
      },
      {
        id: "thread",
        label: "Thread",
        description: "Events from the same Slack thread go to the same conversation.",
        template: "slack:thread:{{payload.event.channel}}:{{payload.event.mistle_thread_root_ts}}",
      },
    ]);
  });
});
