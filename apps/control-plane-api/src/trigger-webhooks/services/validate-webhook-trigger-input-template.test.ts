import type { IntegrationWebhookEventDefinition } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { assertWebhookTriggerInputTemplateReferencesOrThrow } from "./validate-webhook-trigger-input-template.js";

const MessageCreatedEvent: IntegrationWebhookEventDefinition = {
  eventType: "provider.message.created",
  providerEventType: "message.created",
  displayName: "Message created",
  payloadReferences: [
    {
      path: ["messages", "chat_id"],
      description: "Chat ID for the first message.",
    },
    {
      path: ["event"],
      description: "Event payload object.",
      allowsDescendants: true,
    },
    {
      path: ["comment", "body"],
      description: "Comment body.",
    },
  ],
};

const IssueOpenedEvent: IntegrationWebhookEventDefinition = {
  eventType: "provider.issue.opened",
  providerEventType: "issue.opened",
  displayName: "Issue opened",
  payloadReferences: [
    {
      path: ["issue", "number"],
      description: "Issue number.",
    },
  ],
};

describe("assertWebhookTriggerInputTemplateReferencesOrThrow", () => {
  it("allows root payload and references from output and control tags", () => {
    expect(() => {
      assertWebhookTriggerInputTemplateReferencesOrThrow({
        inputTemplate:
          "{% if payload.comment.body %}{{payload.comment.body}}{% endif %}\n{{payload}}",
        eventTypes: [MessageCreatedEvent.eventType],
        supportedWebhookEvents: [MessageCreatedEvent],
      });
    }).not.toThrow();
  });

  it("normalizes numeric array indexes before checking declared payload references", () => {
    expect(() => {
      assertWebhookTriggerInputTemplateReferencesOrThrow({
        inputTemplate: "Chat {{payload.messages[0].chat_id}}",
        eventTypes: [MessageCreatedEvent.eventType],
        supportedWebhookEvents: [MessageCreatedEvent],
      });
    }).not.toThrow();
  });

  it("allows descendants only when the declared reference explicitly allows them", () => {
    expect(() => {
      assertWebhookTriggerInputTemplateReferencesOrThrow({
        inputTemplate: "Event text {{payload.event.text}}",
        eventTypes: [MessageCreatedEvent.eventType],
        supportedWebhookEvents: [MessageCreatedEvent],
      });
    }).not.toThrow();

    expect(() => {
      assertWebhookTriggerInputTemplateReferencesOrThrow({
        inputTemplate: "Comment text {{payload.comment.body.text}}",
        eventTypes: [MessageCreatedEvent.eventType],
        supportedWebhookEvents: [MessageCreatedEvent],
      });
    }).toThrow(
      "Invalid inputTemplate payload reference: payload.comment.body.text is not declared by any selected trigger event.",
    );
  });

  it("allows a reference declared by any selected trigger event", () => {
    expect(() => {
      assertWebhookTriggerInputTemplateReferencesOrThrow({
        inputTemplate: "Comment {{payload.comment.body}} issue {{payload.issue.number}}",
        eventTypes: [MessageCreatedEvent.eventType, IssueOpenedEvent.eventType],
        supportedWebhookEvents: [MessageCreatedEvent, IssueOpenedEvent],
      });
    }).not.toThrow();
  });

  it("allows root webhookEvent and supported webhook event fields", () => {
    expect(() => {
      assertWebhookTriggerInputTemplateReferencesOrThrow({
        inputTemplate: [
          "Webhook {{webhookEvent}}",
          "ID {{webhookEvent.id}}",
          "Event {{webhookEvent.eventType}}",
          "Provider event {{webhookEvent.providerEventType}}",
          "External event {{webhookEvent.externalEventId}}",
          "Delivery {{webhookEvent.externalDeliveryId}}",
        ].join("\n"),
        eventTypes: [MessageCreatedEvent.eventType],
        supportedWebhookEvents: [MessageCreatedEvent],
      });
    }).not.toThrow();
  });

  it("rejects unknown webhook event fields with a webhook event specific error", () => {
    expect(() => {
      assertWebhookTriggerInputTemplateReferencesOrThrow({
        inputTemplate: "Delivery {{webhookEvent.externalDeliveryID}}",
        eventTypes: [MessageCreatedEvent.eventType],
        supportedWebhookEvents: [MessageCreatedEvent],
      });
    }).toThrow(
      "Invalid inputTemplate webhookEvent reference: webhookEvent.externalDeliveryID is not a supported webhook event field.",
    );
  });

  it("rejects descendants below supported webhook event fields", () => {
    expect(() => {
      assertWebhookTriggerInputTemplateReferencesOrThrow({
        inputTemplate: "Delivery {{webhookEvent.externalDeliveryId.value}}",
        eventTypes: [MessageCreatedEvent.eventType],
        supportedWebhookEvents: [MessageCreatedEvent],
      });
    }).toThrow(
      "Invalid inputTemplate webhookEvent reference: webhookEvent.externalDeliveryId.value is not a supported webhook event field.",
    );
  });

  it("rejects dynamic webhook event paths", () => {
    expect(() => {
      assertWebhookTriggerInputTemplateReferencesOrThrow({
        inputTemplate: "Delivery {{webhookEvent[fieldName]}}",
        eventTypes: [MessageCreatedEvent.eventType],
        supportedWebhookEvents: [MessageCreatedEvent],
      });
    }).toThrow(
      "Invalid inputTemplate webhookEvent reference: dynamic webhookEvent paths are not supported.",
    );
  });

  it("rejects malformed Liquid syntax before saving", () => {
    expect(() => {
      assertWebhookTriggerInputTemplateReferencesOrThrow({
        inputTemplate: "Comment {{payload.comment.body",
        eventTypes: [MessageCreatedEvent.eventType],
        supportedWebhookEvents: [MessageCreatedEvent],
      });
    }).toThrow("Invalid inputTemplate Liquid syntax");
  });
});
