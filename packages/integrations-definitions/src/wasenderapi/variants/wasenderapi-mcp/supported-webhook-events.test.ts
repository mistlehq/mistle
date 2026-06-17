import { describe, expect, it } from "vitest";

import { WasenderApiSupportedWebhookEvents } from "./supported-webhook-events.js";

describe("WasenderApiSupportedWebhookEvents", () => {
  it("advertises the exact triggerable message events and provider requirements", () => {
    expect(
      WasenderApiSupportedWebhookEvents.map((eventDefinition) => ({
        eventType: eventDefinition.eventType,
        providerEventType: eventDefinition.providerEventType,
        requirements: eventDefinition.requirements,
      })),
    ).toEqual([
      {
        eventType: "wasenderapi.messages.upsert",
        providerEventType: "messages.upsert",
        requirements: {
          anyOf: [{ event: "messages.upsert" }],
        },
      },
      {
        eventType: "wasenderapi.messages.received",
        providerEventType: "messages.received",
        requirements: {
          anyOf: [{ event: "messages.received" }],
        },
      },
    ]);
    expect(
      WasenderApiSupportedWebhookEvents.some(
        (eventDefinition) => eventDefinition.providerEventType === "session.status",
      ),
    ).toBe(false);
  });
});
