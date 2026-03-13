import { describe, expect, it } from "vitest";

import {
  toCreateWebhookAutomationPayload,
  toUpdateWebhookAutomationPayload,
  toWebhookAutomationFormValues,
  validateWebhookAutomationFormValues,
} from "./webhook-automation-form-helpers.js";
import type { WebhookAutomation } from "./webhook-automations-types.js";

const SampleAutomation: WebhookAutomation = {
  id: "aut_123",
  kind: "webhook",
  name: "GitHub pushes to repo triage",
  enabled: true,
  integrationConnectionId: "conn_github",
  inputTemplate: '{"ref":"{{event.ref}}"}',
  conversationKeyTemplate: "{{event.repository.id}}",
  idempotencyKeyTemplate: null,
  eventTypes: ["push", "pull_request"],
  payloadFilter: { action: "opened" },
  target: {
    id: "target_123",
    sandboxProfileId: "sbp_repo",
    sandboxProfileVersion: null,
  },
  createdAt: "2026-03-11T10:00:00.000Z",
  updatedAt: "2026-03-11T10:05:00.000Z",
};

describe("toWebhookAutomationFormValues", () => {
  it("creates empty defaults for create mode", () => {
    expect(toWebhookAutomationFormValues(null)).toEqual({
      name: "",
      integrationConnectionId: "",
      sandboxProfileId: "",
      enabled: true,
      inputTemplate: "",
      conversationKeyTemplate: "",
      idempotencyKeyTemplate: "",
      eventTypesText: "",
      payloadFilterText: "",
    });
  });

  it("maps an automation resource into form values", () => {
    expect(toWebhookAutomationFormValues(SampleAutomation)).toEqual({
      name: "GitHub pushes to repo triage",
      integrationConnectionId: "conn_github",
      sandboxProfileId: "sbp_repo",
      enabled: true,
      inputTemplate: '{"ref":"{{event.ref}}"}',
      conversationKeyTemplate: "{{event.repository.id}}",
      idempotencyKeyTemplate: "",
      eventTypesText: "push,pull_request",
      payloadFilterText: JSON.stringify({ action: "opened" }, null, 2),
    });
  });
});

describe("validateWebhookAutomationFormValues", () => {
  it("returns field errors for missing required values and invalid JSON filters", () => {
    expect(
      validateWebhookAutomationFormValues({
        name: "",
        integrationConnectionId: "",
        sandboxProfileId: "",
        enabled: true,
        inputTemplate: "",
        conversationKeyTemplate: "",
        idempotencyKeyTemplate: "",
        eventTypesText: "",
        payloadFilterText: "[]",
      }),
    ).toEqual({
      name: "Automation name is required.",
      integrationConnectionId: "Select an integration connection.",
      sandboxProfileId: "Select a sandbox profile.",
      inputTemplate: "Input template is required.",
      conversationKeyTemplate: "Conversation key template is required.",
      payloadFilterText: "Payload filter must be a JSON object.",
    });
  });
});

describe("automation payload transforms", () => {
  it("builds the create payload with normalized optional values", () => {
    expect(
      toCreateWebhookAutomationPayload({
        name: " GitHub pushes to repo triage ",
        integrationConnectionId: "conn_github",
        sandboxProfileId: "sbp_repo",
        enabled: true,
        inputTemplate: '{"ref":"{{event.ref}}"}',
        conversationKeyTemplate: "{{event.repository.id}}",
        idempotencyKeyTemplate: " ",
        eventTypesText: "push, pull_request",
        payloadFilterText: '{\n  "action": "opened"\n}',
      }),
    ).toEqual({
      name: "GitHub pushes to repo triage",
      enabled: true,
      integrationConnectionId: "conn_github",
      inputTemplate: '{"ref":"{{event.ref}}"}',
      conversationKeyTemplate: "{{event.repository.id}}",
      idempotencyKeyTemplate: null,
      eventTypes: ["push", "pull_request"],
      payloadFilter: { action: "opened" },
      target: {
        sandboxProfileId: "sbp_repo",
      },
    });
  });

  it("builds the update payload with nullable optional fields", () => {
    expect(
      toUpdateWebhookAutomationPayload({
        name: "Stripe payouts incident intake",
        integrationConnectionId: "conn_github",
        sandboxProfileId: "sbp_repo",
        enabled: false,
        inputTemplate: "{}",
        conversationKeyTemplate: "{{event.id}}",
        idempotencyKeyTemplate: "",
        eventTypesText: "",
        payloadFilterText: "",
      }),
    ).toEqual({
      name: "Stripe payouts incident intake",
      enabled: false,
      integrationConnectionId: "conn_github",
      inputTemplate: "{}",
      conversationKeyTemplate: "{{event.id}}",
      idempotencyKeyTemplate: null,
      eventTypes: null,
      payloadFilter: null,
      target: {
        sandboxProfileId: "sbp_repo",
      },
    });
  });
});
