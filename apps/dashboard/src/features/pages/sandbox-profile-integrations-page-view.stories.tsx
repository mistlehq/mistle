import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import type React from "react";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import { AutoSaveTitleHeading } from "../shared/auto-save-inline-heading.js";
import { PageFrame } from "../shared/page-frame.js";
import {
  StoryAwsConnection,
  createIntegrationsEditorSectionStoryQueryClient,
  seedStoryIntegrationResources,
  StoryGithubConnection,
  StoryGithubResources,
  StoryIntegrationConnections,
  StoryIntegrationTargets,
  StoryJiraConnection,
  StoryLinearConnection,
  StoryOpenAiConnection,
  StoryPlanetScaleConnection,
  StoryPlanetScaleTools,
} from "./integrations-editor-section-story-support.js";
import { IntegrationsEditorSection } from "./integrations-editor-section.js";
import type { SandboxProfileBindingEditorRow } from "./sandbox-profile-binding-config-editor.js";

const InitialRows: readonly SandboxProfileBindingEditorRow[] = [
  {
    clientId: "row-openai-agent",
    connectionId: StoryOpenAiConnection.id,
    kind: "agent",
    config: {
      model: {
        defaultModel: "gpt-5.3-codex",
        options: {
          reasoningEffort: "medium",
          additionalInstructions: "Stay concise and ask before destructive changes.",
        },
      },
      runtime: {
        runtimeId: "codex",
        config: {},
      },
    },
  },
  {
    clientId: "row-github-git",
    connectionId: StoryGithubConnection.id,
    kind: "git",
    config: {
      repositories: [
        "mistle/main-dashboard",
        "mistle/control-plane-api",
        "mistle/sandbox-runtime",
        "mistle/codex-bridge",
        "mistle/session-workbench",
        "mistle/integration-runtime",
      ],
      tools: ["github-cli"],
    },
  },
  {
    clientId: "row-aws-connector",
    connectionId: StoryAwsConnection.id,
    kind: "connector",
    config: {
      services: ["s3", "sts", "secretsmanager"],
      regions: ["us-east-1", "us-west-2"],
      defaultRegion: "us-east-1",
      tools: ["aws-cli"],
    },
  },
  {
    clientId: "row-jira-connector",
    connectionId: StoryJiraConnection.id,
    kind: "connector",
    config: {
      tools: ["jira-cli"],
    },
  },
  {
    clientId: "row-planetscale-connector",
    connectionId: StoryPlanetScaleConnection.id,
    kind: "connector",
    config: {
      tools: [...StoryPlanetScaleTools],
    },
  },
  {
    clientId: "row-linear-connector",
    connectionId: StoryLinearConnection.id,
    kind: "connector",
    config: {
      tools: ["linear-mcp"],
    },
  },
] as const;

function SandboxProfileIntegrationsPageViewStory(): React.JSX.Element {
  const [queryClient] = useState(() => {
    const client = createIntegrationsEditorSectionStoryQueryClient();
    seedStoryIntegrationResources({
      queryClient: client,
      resources: StoryGithubResources,
    });
    return client;
  });
  const [profileName, setProfileName] = useState("Customer Support Sandbox");
  const [rows, setRows] = useState<readonly SandboxProfileBindingEditorRow[]>(InitialRows);

  return (
    <QueryClientProvider client={queryClient}>
      <PageFrame maxWidthClassName="max-w-5xl" title="">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <AutoSaveTitleHeading
              ariaLabel="Profile name"
              emptyDisplayText="Untitled profile"
              onSave={async (nextValue) => {
                setProfileName(nextValue);
              }}
              requiredLabel="Profile name"
              value={profileName}
            />
          </div>

          <IntegrationsEditorSection
            availableConnections={StoryIntegrationConnections}
            availableTargets={StoryIntegrationTargets}
            integrationBindingsQuery={{
              isError: false,
              error: null,
              isPending: false,
            }}
            integrationDirectoryQuery={{
              isError: false,
              error: null,
              isPending: false,
            }}
            integrationRowErrorsByClientId={{}}
            integrationRows={rows}
            integrationSaveError={null}
            isSubmittingIntegrationBindings={false}
            onAddIntegrationBindingRow={async (input) => {
              setRows((currentRows) => [
                ...currentRows,
                {
                  clientId: `row-${String(currentRows.length + 1)}`,
                  connectionId: input.connectionId,
                  kind: input.kind,
                  config: input.config,
                },
              ]);
              return true;
            }}
            onIntegrationBindingRowChange={(clientId, changes) => {
              setRows((currentRows) =>
                currentRows.map((row) =>
                  row.clientId === clientId ? { ...row, ...changes } : row,
                ),
              );
            }}
            onRemoveIntegrationBindingRow={(clientId) => {
              setRows((currentRows) => currentRows.filter((row) => row.clientId !== clientId));
            }}
          />
        </div>
      </PageFrame>
    </QueryClientProvider>
  );
}

const meta = {
  title: "Dashboard/SandboxProfiles/Integrations/PageView",
  component: SandboxProfileIntegrationsPageViewStory,
  decorators: [withDashboardPageStory],
} satisfies Meta<typeof SandboxProfileIntegrationsPageViewStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
