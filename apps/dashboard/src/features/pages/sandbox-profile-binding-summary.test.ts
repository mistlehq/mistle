// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import type {
  IntegrationConnectionSummary,
  IntegrationTargetSummary,
  SandboxProfileBindingEditorRow,
} from "./sandbox-profile-binding-config-editor.js";
import { formatSandboxProfileBindingSummaryItems } from "./sandbox-profile-binding-summary.js";

describe("formatSandboxProfileBindingSummaryItems", () => {
  it("renders array-backed tool selections with human-readable labels", () => {
    const target: IntegrationTargetSummary = {
      targetKey: "target-github",
      displayName: "GitHub",
      familyId: "github",
      variantId: "github-cloud",
      config: {
        api_base_url: "https://api.github.com",
        web_base_url: "https://github.com",
      },
      targetHealth: {
        configStatus: "valid",
      },
    };
    const connection: IntegrationConnectionSummary = {
      id: "connection-github",
      displayName: "GitHub Production",
      targetKey: target.targetKey,
      status: "active",
      resources: [
        {
          kind: "repository",
          selectionMode: "multi",
          count: 24,
          syncState: "ready",
          lastSyncedAt: "2026-03-09T12:00:00.000Z",
        },
      ],
      config: {
        connection_method: "github-app-installation",
        app_id: "123",
        app_slug: "mistle-github-app",
        installation_id: "12345",
      },
    };
    const row: SandboxProfileBindingEditorRow = {
      clientId: "row-github",
      connectionId: connection.id,
      kind: "git",
      config: {
        repositories: ["mistlehq/mistle"],
        tools: ["github-cli"],
      },
    };

    expect(
      formatSandboxProfileBindingSummaryItems({
        row,
        availableConnections: [connection],
        availableTargets: [target],
      }),
    ).toEqual([
      {
        label: "Repositories",
        value: "mistlehq/mistle",
      },
      {
        label: "Tools",
        value: "GitHub CLI",
      },
    ]);
  });

  it("renders Jira tool selections with human-readable labels", () => {
    const target: IntegrationTargetSummary = {
      targetKey: "target-jira",
      displayName: "Jira",
      familyId: "jira",
      variantId: "jira-default",
      config: {},
      targetHealth: {
        configStatus: "valid",
      },
    };
    const connection: IntegrationConnectionSummary = {
      id: "connection-jira",
      displayName: "Jira Production",
      targetKey: target.targetKey,
      status: "active",
      config: {
        connection_method: "jira-personal-api-token",
        site_url: "https://mistle.atlassian.net",
        email: "user@example.com",
      },
    };
    const row: SandboxProfileBindingEditorRow = {
      clientId: "row-jira",
      connectionId: connection.id,
      kind: "connector",
      config: {
        tools: ["jira-cli"],
      },
    };

    expect(
      formatSandboxProfileBindingSummaryItems({
        row,
        availableConnections: [connection],
        availableTargets: [target],
      }),
    ).toEqual([
      {
        label: "Tools",
        value: "Jira CLI",
      },
    ]);
  });

  it("renders Linear MCP tool selections with human-readable labels", () => {
    const target: IntegrationTargetSummary = {
      targetKey: "target-linear",
      displayName: "Linear",
      familyId: "linear",
      variantId: "linear-default",
      config: {},
      targetHealth: {
        configStatus: "valid",
      },
    };
    const connection: IntegrationConnectionSummary = {
      id: "connection-linear",
      displayName: "Linear Workspace",
      targetKey: target.targetKey,
      status: "active",
      config: {
        connection_method: "api-key",
      },
    };
    const row: SandboxProfileBindingEditorRow = {
      clientId: "row-linear",
      connectionId: connection.id,
      kind: "connector",
      config: {
        tools: ["linear-mcp"],
      },
    };

    expect(
      formatSandboxProfileBindingSummaryItems({
        row,
        availableConnections: [connection],
        availableTargets: [target],
      }),
    ).toEqual([
      {
        label: "Tools",
        value: "Linear MCP",
      },
    ]);
  });

  it("renders an explicit empty tool summary when no Linear tools are selected", () => {
    const target: IntegrationTargetSummary = {
      targetKey: "target-linear",
      displayName: "Linear",
      familyId: "linear",
      variantId: "linear-default",
      config: {},
      targetHealth: {
        configStatus: "valid",
      },
    };
    const connection: IntegrationConnectionSummary = {
      id: "connection-linear",
      displayName: "Linear Workspace",
      targetKey: target.targetKey,
      status: "active",
      config: {
        connection_method: "api-key",
      },
    };
    const row: SandboxProfileBindingEditorRow = {
      clientId: "row-linear",
      connectionId: connection.id,
      kind: "connector",
      config: {},
    };

    expect(
      formatSandboxProfileBindingSummaryItems({
        row,
        availableConnections: [connection],
        availableTargets: [target],
      }),
    ).toEqual([
      {
        label: "Tools",
        value: "None",
      },
    ]);
  });
});
