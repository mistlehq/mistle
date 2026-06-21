import { describe, expect, it } from "vitest";

import { WhapiSupportedWebhookEvents } from "./supported-webhook-events.js";

describe("WhapiSupportedWebhookEvents", () => {
  it("advertises WHAPI dashboard trigger events", () => {
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
        eventType: "whapi.messages.delete",
        providerEventType: "messages.delete",
        requirements: {
          anyOf: [{ event: "messages.delete" }],
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
        eventType: "whapi.chats.post",
        providerEventType: "chats.post",
        requirements: {
          anyOf: [{ event: "chats.post" }],
        },
      },
      {
        eventType: "whapi.chats.put",
        providerEventType: "chats.put",
        requirements: {
          anyOf: [{ event: "chats.put" }],
        },
      },
      {
        eventType: "whapi.chats.delete",
        providerEventType: "chats.delete",
        requirements: {
          anyOf: [{ event: "chats.delete" }],
        },
      },
      {
        eventType: "whapi.chats.patch",
        providerEventType: "chats.patch",
        requirements: {
          anyOf: [{ event: "chats.patch" }],
        },
      },
      {
        eventType: "whapi.contacts.post",
        providerEventType: "contacts.post",
        requirements: {
          anyOf: [{ event: "contacts.post" }],
        },
      },
      {
        eventType: "whapi.contacts.patch",
        providerEventType: "contacts.patch",
        requirements: {
          anyOf: [{ event: "contacts.patch" }],
        },
      },
      {
        eventType: "whapi.groups.post",
        providerEventType: "groups.post",
        requirements: {
          anyOf: [{ event: "groups.post" }],
        },
      },
      {
        eventType: "whapi.groups.put",
        providerEventType: "groups.put",
        requirements: {
          anyOf: [{ event: "groups.put" }],
        },
      },
      {
        eventType: "whapi.groups.patch",
        providerEventType: "groups.patch",
        requirements: {
          anyOf: [{ event: "groups.patch" }],
        },
      },
      {
        eventType: "whapi.presences.post",
        providerEventType: "presences.post",
        requirements: {
          anyOf: [{ event: "presences.post" }],
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
        eventType: "whapi.channel.patch",
        providerEventType: "channel.patch",
        requirements: {
          anyOf: [{ event: "channel.patch" }],
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
      {
        eventType: "whapi.labels.post",
        providerEventType: "labels.post",
        requirements: {
          anyOf: [{ event: "labels.post" }],
        },
      },
      {
        eventType: "whapi.labels.delete",
        providerEventType: "labels.delete",
        requirements: {
          anyOf: [{ event: "labels.delete" }],
        },
      },
      {
        eventType: "whapi.calls.post",
        providerEventType: "calls.post",
        requirements: {
          anyOf: [{ event: "calls.post" }],
        },
      },
    ]);
  });
});
