import { describe, expect, it } from "vitest";

import type {
  IntegrationConnection,
  IntegrationTarget,
} from "../integrations/integrations-service.js";
import type { SandboxProfile } from "../sandbox-profiles/sandbox-profiles-types.js";
import {
  buildWebhookAutomationConnectionOptions,
  buildWebhookAutomationListItems,
  buildWebhookAutomationSandboxProfileOptions,
  toCreateWebhookAutomationPayload,
  toWebhookAutomationFormValues,
  toUpdateWebhookAutomationPayload,
  validateWebhookAutomationFormValues,
} from "./webhook-automations-page-helpers.js";
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

const SampleConnections: readonly IntegrationConnection[] = [
  {
    id: "conn_github",
    targetKey: "github",
    displayName: "GitHub Engineering",
    status: "active",
    createdAt: "2026-03-11T10:00:00.000Z",
    updatedAt: "2026-03-11T10:05:00.000Z",
  },
  {
    id: "conn_linear",
    targetKey: "linear",
    displayName: "Linear Product",
    status: "revoked",
    createdAt: "2026-03-11T10:00:00.000Z",
    updatedAt: "2026-03-11T10:05:00.000Z",
  },
];

const SampleTargets: readonly IntegrationTarget[] = [
  {
    targetKey: "github",
    familyId: "github",
    variantId: "default",
    enabled: true,
    config: {},
    displayName: "GitHub",
    description: "GitHub repositories",
    targetHealth: {
      configStatus: "valid",
    },
  },
  {
    targetKey: "linear",
    familyId: "linear",
    variantId: "default",
    enabled: true,
    config: {},
    displayName: "Linear",
    description: "Linear issues",
    targetHealth: {
      configStatus: "valid",
    },
  },
];

const SampleSandboxProfiles: readonly SandboxProfile[] = [
  {
    id: "sbp_repo",
    organizationId: "org_123",
    displayName: "Repo Maintainer",
    status: "active",
    createdAt: "2026-03-10T10:00:00.000Z",
    updatedAt: "2026-03-11T10:00:00.000Z",
  },
  {
    id: "sbp_finance",
    organizationId: "org_123",
    displayName: "Finance Investigator",
    status: "inactive",
    createdAt: "2026-03-10T10:00:00.000Z",
    updatedAt: "2026-03-11T10:00:00.000Z",
  },
];

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

describe("buildWebhookAutomationConnectionOptions", () => {
  it("keeps only active connections and adds target descriptions", () => {
    expect(
      buildWebhookAutomationConnectionOptions({
        connections: SampleConnections,
        targets: SampleTargets,
      }),
    ).toEqual([
      {
        value: "conn_github",
        label: "GitHub Engineering",
        description: "GitHub",
      },
    ]);
  });
});

describe("buildWebhookAutomationSandboxProfileOptions", () => {
  it("maps sandbox profiles into sorted select options", () => {
    expect(
      buildWebhookAutomationSandboxProfileOptions({
        sandboxProfiles: SampleSandboxProfiles,
      }),
    ).toEqual([
      {
        value: "sbp_finance",
        label: "Finance Investigator",
        description: "inactive",
      },
      {
        value: "sbp_repo",
        label: "Repo Maintainer",
        description: "active",
      },
    ]);
  });
});

describe("buildWebhookAutomationListItems", () => {
  it("joins display names for connections and sandbox profiles", () => {
    const items = buildWebhookAutomationListItems({
      automations: [SampleAutomation],
      connections: SampleConnections,
      sandboxProfiles: SampleSandboxProfiles,
    });
    const item = items[0];

    if (item === undefined) {
      throw new Error("Expected one automation list item.");
    }

    expect(item).toMatchObject({
      id: "aut_123",
      name: "GitHub pushes to repo triage",
      integrationConnectionName: "GitHub Engineering",
      sandboxProfileName: "Repo Maintainer",
      eventSummary: "push, pull_request",
      enabled: true,
    });
    expect(item.updatedAtLabel.length).toBeGreaterThan(0);
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
