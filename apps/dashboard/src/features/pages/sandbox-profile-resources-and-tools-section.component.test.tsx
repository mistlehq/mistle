// @vitest-environment jsdom

import {
  AssociatedProviderResourceKinds,
  AssociatedResourceEventTypes,
} from "@mistle/integrations-core";
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createTestQueryClient } from "../../test-support/query-client.js";
import type { IntegrationConnectionResources } from "../integrations/integrations-service.js";
import type { SandboxProfileVersion } from "../sandbox-profiles/sandbox-profiles-types.js";
import {
  StorySlackConnection,
  StorySlackTarget,
} from "./integrations-editor-section-story-support.js";
import { SandboxProfileBindingResourcesAndToolsCell } from "./sandbox-profile-resources-and-tools-section.js";

afterEach(() => {
  cleanup();
});

describe("SandboxProfileBindingResourcesAndToolsCell", () => {
  it("passes the Slack row connection id into associated resource channel filters", async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(
      ["trigger-trigger-parameters", StorySlackConnection.id, "channel"],
      createSlackChannelResources(),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <SandboxProfileBindingResourcesAndToolsCell
          availableConnections={[StorySlackConnection]}
          availableTargets={[StorySlackTarget]}
          associatedResourceRouting={{
            hasSlackThreadBinding: true,
            isDraft: true,
            version: createVersion({
              associatedResourceEventRoutingConfig: {
                enabled: true,
                resources: [
                  {
                    resourceKind: AssociatedProviderResourceKinds.SLACK_THREAD,
                    eventTypes: [AssociatedResourceEventTypes.SLACK_THREAD_MESSAGE_CREATED],
                    payloadFilter: {
                      [AssociatedResourceEventTypes.SLACK_THREAD_MESSAGE_CREATED]: {
                        op: "eq",
                        path: ["event", "channel"],
                        value: "C12345678",
                      },
                    },
                  },
                ],
              },
            }),
          }}
          onRowChange={() => {}}
          row={{
            clientId: "slack-row",
            connectionId: StorySlackConnection.id,
            kind: "connector",
            config: {},
          }}
        />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Configure Agent-started Slack threads" }));

    await waitFor(() => {
      expect(screen.getAllByDisplayValue("#alerts").length).toBeGreaterThan(0);
    });
  });
});

function createVersion(input?: {
  associatedResourceEventRoutingConfig?: SandboxProfileVersion["associatedResourceEventRoutingConfig"];
}): SandboxProfileVersion {
  return {
    sandboxProfileId: "sbp_resources_and_tools",
    version: 1,
    state: "draft",
    publishedAt: null,
    agentRuntimeId: "codex",
    gitCommitSigningIntegrationConnectionId: null,
    mistleMcpEnabled: false,
    mistleMcpApiKeyId: null,
    sandboxProvider: "docker",
    sandboxConnectionId: null,
    maintenanceScript: null,
    sandboxResources: null,
    skillsConfig: null,
    associatedResourceEventRoutingConfig: input?.associatedResourceEventRoutingConfig ?? {},
    isActive: false,
    usable: false,
    latestSnapshotJob: null,
    refreshSchedule: null,
  };
}

function createSlackChannelResources(): IntegrationConnectionResources {
  return {
    connectionId: StorySlackConnection.id,
    familyId: "slack",
    kind: "channel",
    syncState: "ready",
    items: [
      {
        id: "icr_slack_channel_1",
        familyId: "slack",
        kind: "channel",
        externalId: "C12345678",
        handle: "C12345678",
        displayName: "#alerts",
        status: "accessible",
        metadata: {},
      },
    ],
  };
}
