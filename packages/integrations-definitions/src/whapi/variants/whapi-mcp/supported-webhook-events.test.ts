import { describe, expect, it } from "vitest";

import { WhapiSupportedWebhookEvents } from "./supported-webhook-events.js";

describe("WhapiSupportedWebhookEvents", () => {
  it("advertises documented triggerable message, status, channel, and user events", () => {
    expect(
      WhapiSupportedWebhookEvents.map((eventDefinition) => ({
        eventType: eventDefinition.eventType,
        providerEventType: eventDefinition.providerEventType,
        requirements: eventDefinition.requirements,
      })),
    ).toEqual([
      {
        eventType: "whapi.messages.post",
        providerEventType: "messages.post",
        requirements: {
          anyOf: [{ event: "messages.post" }],
        },
      },
      {
        eventType: "whapi.messages.put",
        providerEventType: "messages.put",
        requirements: {
          anyOf: [{ event: "messages.put" }],
        },
      },
      {
        eventType: "whapi.messages.patch",
        providerEventType: "messages.patch",
        requirements: {
          anyOf: [{ event: "messages.patch" }],
        },
      },
      {
        eventType: "whapi.statuses.post",
        providerEventType: "statuses.post",
        requirements: {
          anyOf: [{ event: "statuses.post" }],
        },
      },
      {
        eventType: "whapi.statuses.put",
        providerEventType: "statuses.put",
        requirements: {
          anyOf: [{ event: "statuses.put" }],
        },
      },
      {
        eventType: "whapi.channel.post",
        providerEventType: "channel.post",
        requirements: {
          anyOf: [{ event: "channel.post" }],
        },
      },
      {
        eventType: "whapi.users.post",
        providerEventType: "users.post",
        requirements: {
          anyOf: [{ event: "users.post" }],
        },
      },
      {
        eventType: "whapi.users.delete",
        providerEventType: "users.delete",
        requirements: {
          anyOf: [{ event: "users.delete" }],
        },
      },
    ]);
  });
});
