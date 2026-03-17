import { describe, expect, it } from "vitest";

import {
  toCreateWebhookAutomationPayload,
  toUpdateWebhookAutomationPayload,
  toWebhookAutomationFormValues,
  validateWebhookAutomationFormValues,
} from "./webhook-automation-form-helpers.js";
import type { WebhookAutomationEventOption } from "./webhook-automation-trigger-types.js";
import type { WebhookAutomation } from "./webhook-automations-types.js";

const GitHubEventOptions: readonly WebhookAutomationEventOption[] = [
  {
    value: "github.pull_request.opened",
    label: "Pull request opened",
    parameters: [
      {
        id: "repository",
        label: "repository",
        kind: "resource-select",
        resourceKind: "repository",
        payloadPath: ["repository", "full_name"],
        prefix: "in",
      },
    ],
  },
];

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
  payloadFilter: {
    op: "eq",
    path: ["action"],
    value: "opened",
  },
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
      eventTypes: [],
      triggerParameterValues: {},
      payloadFilterEditorMode: "builder",
      payloadFilterBuilderMode: "all",
      payloadFilterConditions: [],
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
      eventTypes: ["push", "pull_request"],
      triggerParameterValues: {},
      payloadFilterEditorMode: "builder",
      payloadFilterBuilderMode: "all",
      payloadFilterConditions: [
        {
          id: "condition_0",
          pathText: "action",
          operator: "eq",
          valueType: "string",
          valueText: "opened",
          valuesText: "",
        },
      ],
      payloadFilterText: JSON.stringify(
        {
          op: "eq",
          path: ["action"],
          value: "opened",
        },
        null,
        2,
      ),
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
        eventTypes: [],
        triggerParameterValues: {},
        payloadFilterEditorMode: "builder",
        payloadFilterBuilderMode: "all",
        payloadFilterConditions: [
          {
            id: "condition_0",
            pathText: "",
            operator: "contains",
            valueType: "string",
            valueText: "",
            valuesText: "",
          },
        ],
        payloadFilterText: "[]",
      }),
    ).toEqual({
      name: "Automation name is required.",
      integrationConnectionId: "Select an integration connection.",
      sandboxProfileId: "Select a sandbox profile.",
      inputTemplate: "Input template is required.",
      conversationKeyTemplate: "Conversation key template is required.",
      payloadFilterText:
        "Conditions must include a field path and valid value for the selected operator.",
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
        eventTypes: ["push", "pull_request"],
        triggerParameterValues: {},
        payloadFilterEditorMode: "builder",
        payloadFilterBuilderMode: "all",
        payloadFilterConditions: [
          {
            id: "condition_0",
            pathText: "action",
            operator: "eq",
            valueType: "string",
            valueText: "opened",
            valuesText: "",
          },
        ],
        payloadFilterText: "",
      }),
    ).toEqual({
      name: "GitHub pushes to repo triage",
      enabled: true,
      integrationConnectionId: "conn_github",
      inputTemplate: '{"ref":"{{event.ref}}"}',
      conversationKeyTemplate: "{{event.repository.id}}",
      idempotencyKeyTemplate: null,
      eventTypes: ["push", "pull_request"],
      payloadFilter: {
        op: "eq",
        path: ["action"],
        value: "opened",
      },
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
        eventTypes: [],
        triggerParameterValues: {},
        payloadFilterEditorMode: "builder",
        payloadFilterBuilderMode: "all",
        payloadFilterConditions: [],
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

  it("builds the update payload from raw JSON when the JSON editor is selected", () => {
    expect(
      toUpdateWebhookAutomationPayload({
        name: "Issue comments routing",
        integrationConnectionId: "conn_github",
        sandboxProfileId: "sbp_repo",
        enabled: true,
        inputTemplate: "{}",
        conversationKeyTemplate: "{{event.id}}",
        idempotencyKeyTemplate: "",
        eventTypes: ["push"],
        triggerParameterValues: {},
        payloadFilterEditorMode: "json",
        payloadFilterBuilderMode: "all",
        payloadFilterConditions: [],
        payloadFilterText:
          '{\n  "op": "contains",\n  "path": ["repository", "full_name"],\n  "value": "mistle"\n}',
      }),
    ).toEqual({
      name: "Issue comments routing",
      enabled: true,
      integrationConnectionId: "conn_github",
      inputTemplate: "{}",
      conversationKeyTemplate: "{{event.id}}",
      idempotencyKeyTemplate: null,
      eventTypes: ["push"],
      payloadFilter: {
        op: "contains",
        path: ["repository", "full_name"],
        value: "mistle",
      },
      target: {
        sandboxProfileId: "sbp_repo",
      },
    });
  });

  it("builds trigger parameter filters into the payload filter", () => {
    expect(
      toCreateWebhookAutomationPayload(
        {
          name: "Pull request routing",
          integrationConnectionId: "conn_github",
          sandboxProfileId: "sbp_repo",
          enabled: true,
          inputTemplate: "{}",
          conversationKeyTemplate: "{{event.id}}",
          idempotencyKeyTemplate: "",
          eventTypes: ["github.pull_request.opened"],
          triggerParameterValues: {
            "github.pull_request.opened": {
              repository: "mistlehq/mistle",
            },
          },
          payloadFilterEditorMode: "builder",
          payloadFilterBuilderMode: "all",
          payloadFilterConditions: [],
          payloadFilterText: "",
        },
        GitHubEventOptions,
      ),
    ).toEqual({
      name: "Pull request routing",
      enabled: true,
      integrationConnectionId: "conn_github",
      inputTemplate: "{}",
      conversationKeyTemplate: "{{event.id}}",
      idempotencyKeyTemplate: null,
      eventTypes: ["github.pull_request.opened"],
      payloadFilter: {
        op: "eq",
        path: ["repository", "full_name"],
        value: "mistlehq/mistle",
      },
      target: {
        sandboxProfileId: "sbp_repo",
      },
    });
  });
});
