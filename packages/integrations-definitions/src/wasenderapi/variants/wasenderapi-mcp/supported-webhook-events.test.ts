import { describe, expect, it } from "vitest";

import {
  WasenderApiSupportedWebhookEvents,
  WasenderApiWebhookEventMetadata,
} from "./supported-webhook-events.js";

describe("WasenderApiSupportedWebhookEvents", () => {
  it("advertises the documented WasenderAPI dashboard events Mistle supports", () => {
    expect(
      WasenderApiSupportedWebhookEvents.map((eventDefinition) => ({
        eventType: eventDefinition.eventType,
        providerEventType: eventDefinition.providerEventType,
        requirements: eventDefinition.requirements,
      })),
    ).toEqual(
      WasenderApiWebhookEventMetadata.map((metadata) => ({
        eventType: `wasenderapi.${metadata.providerEventType}`,
        providerEventType: metadata.providerEventType,
        requirements: {
          anyOf: [{ event: metadata.providerEventType }],
        },
      })),
    );
  });

  it("keeps WasenderAPI event source documentation next to provider event metadata", () => {
    expect(
      WasenderApiWebhookEventMetadata.every((metadata) => metadata.docsUrl.startsWith("https://")),
    ).toBe(true);
  });
});
