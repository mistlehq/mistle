import { WasenderApiSupportedWebhookEvents } from "@mistle/integrations-definitions/server";
import { describe, expect, it } from "vitest";

import { renderTemplateString } from "./render-template-string.js";

function resolveWasenderApiMessageEventConversationTemplate(input: {
  eventType: "wasenderapi.messages.received" | "wasenderapi.messages.upsert";
  conversationKeyOptionId: "message" | "remote-jid";
}): string {
  const eventDefinition = WasenderApiSupportedWebhookEvents.find(
    (event) => event.eventType === input.eventType,
  );
  const conversationKeyOption = eventDefinition?.conversationKeyOptions?.find(
    (option) => option.id === input.conversationKeyOptionId,
  );

  if (conversationKeyOption === undefined) {
    throw new Error(
      `WasenderAPI conversation key option '${input.conversationKeyOptionId}' is missing.`,
    );
  }

  return conversationKeyOption.template;
}

describe("WasenderAPI conversation key templates", () => {
  it("renders documented object-shaped received message payloads", () => {
    const rendered = renderTemplateString({
      template: resolveWasenderApiMessageEventConversationTemplate({
        eventType: "wasenderapi.messages.received",
        conversationKeyOptionId: "remote-jid",
      }),
      context: {
        payload: {
          data: {
            messages: {
              key: {
                remoteJid: "1234567890@s.whatsapp.net",
              },
            },
          },
        },
      },
    });

    expect(rendered).toBe("wasenderapi:chat:1234567890@s.whatsapp.net");
  });

  it("renders documented array-shaped upsert message payloads", () => {
    const rendered = renderTemplateString({
      template: resolveWasenderApiMessageEventConversationTemplate({
        eventType: "wasenderapi.messages.upsert",
        conversationKeyOptionId: "message",
      }),
      context: {
        payload: {
          data: {
            messages: [
              {
                key: {
                  id: "message-id-123",
                },
              },
            ],
          },
        },
      },
    });

    expect(rendered).toBe("wasenderapi:message:message-id-123");
  });
});
