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
        installation_id: 12345,
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
        value: "GitHub CLI (gh)",
      },
    ]);
  });
});
