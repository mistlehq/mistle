import { describe, expect, it } from "vitest";

import { TelegramSupportedWebhookEvents } from "./supported-webhook-events.js";

function requireTelegramEvent(providerEventType: string) {
  const eventDefinition = TelegramSupportedWebhookEvents.find(
    (candidate) => candidate.providerEventType === providerEventType,
  );
  if (eventDefinition === undefined) {
    throw new Error(`Expected Telegram event '${providerEventType}' to exist.`);
  }

  return eventDefinition;
}

function requireConversationKeyOption(input: { providerEventType: string; optionId: string }) {
  const eventDefinition = requireTelegramEvent(input.providerEventType);
  const option = eventDefinition.conversationKeyOptions?.find(
    (candidate) => candidate.id === input.optionId,
  );
  if (option === undefined) {
    throw new Error(
      `Expected Telegram event '${input.providerEventType}' to include conversation key option '${input.optionId}'.`,
    );
  }

  return option;
}

describe("Telegram supported webhook event metadata", () => {
  it("only publishes payload-qualified conversation key templates", () => {
    for (const eventDefinition of TelegramSupportedWebhookEvents) {
      for (const option of eventDefinition.conversationKeyOptions ?? []) {
        expect(option.template).toContain("{{ payload.");
      }
    }
  });

  it("uses payload-qualified update conversation key templates for every update type", () => {
    for (const eventDefinition of TelegramSupportedWebhookEvents) {
      expect(
        requireConversationKeyOption({
          providerEventType: eventDefinition.providerEventType,
          optionId: "update",
        }).template,
      ).toBe("{{ payload.update_id }}");
    }
  });

  it("uses provider-specific payload-qualified chat conversation key templates", () => {
    expect(
      requireConversationKeyOption({ providerEventType: "message", optionId: "chat" }).template,
    ).toBe("{{ payload.message.chat.id }}");
    expect(
      requireConversationKeyOption({ providerEventType: "edited_message", optionId: "chat" })
        .template,
    ).toBe("{{ payload.edited_message.chat.id }}");
    expect(
      requireConversationKeyOption({ providerEventType: "channel_post", optionId: "chat" })
        .template,
    ).toBe("{{ payload.channel_post.chat.id }}");
    expect(
      requireConversationKeyOption({ providerEventType: "business_connection", optionId: "chat" })
        .template,
    ).toBe("{{ payload.business_connection.user_chat_id }}");
    expect(
      requireConversationKeyOption({ providerEventType: "callback_query", optionId: "chat" })
        .template,
    ).toBe("{{ payload.callback_query.message.chat.id }}");
  });

  it("does not offer chat grouping for update types without a chat payload path", () => {
    expect(
      requireTelegramEvent("inline_query").conversationKeyOptions?.map((option) => option.id),
    ).toEqual(["update"]);
    expect(requireTelegramEvent("poll").conversationKeyOptions?.map((option) => option.id)).toEqual(
      ["update"],
    );
    expect(
      requireTelegramEvent("purchased_paid_media").conversationKeyOptions?.map(
        (option) => option.id,
      ),
    ).toEqual(["update"]);
  });
});
