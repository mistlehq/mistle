import { systemScheduler, type TimerHandle } from "@mistle/time";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { createMemoryRouter, createRoutesFromElements, Route, RouterProvider } from "react-router";
import { userEvent, within } from "storybook/test";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import {
  clearPendingStatusTimeouts,
  scheduleSavedStateReset,
} from "../shared/auto-save-behavior.js";
import {
  createIntegrationsEditorSectionStoryQueryClient,
  seedStoryIntegrationResources,
  StoryAwsConnection,
  StoryGithubConnection,
  StoryGithubResources,
  StoryIntegrationConnections,
  StoryIntegrationTargets,
  StoryJiraConnection,
  StoryLinearConnection,
  StoryOpenAiConnection,
  StoryPlanetScaleConnection,
} from "./integrations-editor-section-story-support.js";
import { IntegrationsEditorSection } from "./integrations-editor-section.js";
import type { SandboxProfileBindingEditorRow } from "./sandbox-profile-binding-config-editor.js";
import {
  SandboxProfileEditorView,
  SandboxProfileSetupScriptPanel,
} from "./sandbox-profile-editor-page.js";
import type { SandboxProfileEditorSection } from "./sandbox-profile-editor-sections.js";
import { mapBindingsToEditorRows } from "./sandbox-profile-integrations-state.js";

type SandboxProfileEditorPageStoryArgs = {
  displayName: string;
  setupScript: string | null;
};

const StorySections = [
  {
    id: "agent",
    label: "Agent Harness",
  },
  {
    id: "git",
    label: "Git Provider",
  },
  {
    id: "connector",
    label: "Connectors",
  },
  {
    id: "configurations",
    label: "Configurations",
  },
] as const satisfies readonly SandboxProfileEditorSection[];

const StoryBindings = [
  {
    id: "binding-openai-agent",
    connectionId: StoryOpenAiConnection.id,
    kind: "agent" as const,
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
    id: "binding-github-git",
    connectionId: StoryGithubConnection.id,
    kind: "git" as const,
    config: {
      repositories: ["mistle/main-dashboard", "mistle/control-plane-api", "mistle/sandbox-runtime"],
      tools: ["github-cli"],
    },
  },
  {
    id: "binding-jira-connector",
    connectionId: StoryJiraConnection.id,
    kind: "connector" as const,
    config: {
      tools: ["jira-cli"],
    },
  },
  {
    id: "binding-linear-connector",
    connectionId: StoryLinearConnection.id,
    kind: "connector" as const,
    config: {
      tools: ["linear-mcp"],
    },
  },
  {
    id: "binding-planetscale-connector",
    connectionId: StoryPlanetScaleConnection.id,
    kind: "connector" as const,
    config: {
      tools: ["pscale"],
    },
  },
  {
    id: "binding-aws-connector",
    connectionId: StoryAwsConnection.id,
    kind: "connector" as const,
    config: {
      tools: ["aws-cli"],
    },
  },
] as const;

function SandboxProfileEditorPageStoryView(
  input: SandboxProfileEditorPageStoryArgs,
): React.JSX.Element {
  const [queryClient] = useState(() => {
    const client = createIntegrationsEditorSectionStoryQueryClient();
    seedStoryIntegrationResources({
      queryClient: client,
      resources: StoryGithubResources,
    });
    return client;
  });
  const [profileName, setProfileName] = useState(input.displayName);
  const [integrationRows, setIntegrationRows] = useState<readonly SandboxProfileBindingEditorRow[]>(
    () => mapBindingsToEditorRows(StoryBindings),
  );
  const [setupScriptDraft, setSetupScriptDraft] = useState(input.setupScript ?? "");
  const [persistedSetupScript, setPersistedSetupScript] = useState(input.setupScript ?? "");
  const [setupScriptSaveStatus, setSetupScriptSaveStatus] = useState<
    "idle" | "saving" | "saved" | "saved-fading"
  >("idle");
  const fadeStartTimeoutRef = useRef<TimerHandle | null>(null);
  const fadeEndTimeoutRef = useRef<TimerHandle | null>(null);

  useEffect(() => {
    return () => {
      clearPendingStatusTimeouts({
        fadeEndTimeoutRef,
        fadeStartTimeoutRef,
        scheduler: systemScheduler,
      });
    };
  }, []);

  async function handleProfileNameSave(nextValue: string): Promise<void> {
    setProfileName(nextValue);
  }

  function handleSetupScriptBlur(): void {
    if (setupScriptDraft === persistedSetupScript) {
      setSetupScriptSaveStatus("idle");
      return;
    }

    clearPendingStatusTimeouts({
      fadeEndTimeoutRef,
      fadeStartTimeoutRef,
      scheduler: systemScheduler,
    });
    setPersistedSetupScript(setupScriptDraft);
    setSetupScriptSaveStatus("saved");
    scheduleSavedStateReset({
      fadeEndTimeoutRef,
      fadeStartTimeoutRef,
      onFadeEnd: () => {
        setSetupScriptSaveStatus("idle");
      },
      onFadeStart: () => {
        setSetupScriptSaveStatus("saved-fading");
      },
      scheduler: systemScheduler,
      successFadeDurationMs: 700,
      successVisibleDurationMs: 2200,
    });
  }

  return (
    <QueryClientProvider client={queryClient}>
      <SandboxProfileEditorView
        onSaveProfileName={handleProfileNameSave}
        profileName={profileName}
        profileNameFallback={profileName}
        renderSectionPanel={(sectionId) => {
          if (sectionId === "agent") {
            return (
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
                integrationRows={integrationRows}
                integrationSaveError={null}
                isSubmittingIntegrationBindings={false}
                onAddIntegrationBindingRow={async (nextBinding) => {
                  setIntegrationRows((currentRows) => [
                    ...currentRows,
                    {
                      clientId: `row-${String(currentRows.length + 1)}`,
                      connectionId: nextBinding.connectionId,
                      kind: nextBinding.kind,
                      config: nextBinding.config,
                    },
                  ]);
                  return true;
                }}
                onIntegrationBindingRowChange={(clientId, changes) => {
                  setIntegrationRows((currentRows) =>
                    currentRows.map((row) =>
                      row.clientId === clientId ? { ...row, ...changes } : row,
                    ),
                  );
                }}
                onRemoveIntegrationBindingRow={(clientId) => {
                  setIntegrationRows((currentRows) =>
                    currentRows.filter((row) => row.clientId !== clientId),
                  );
                }}
                sectionKinds={["agent"]}
                showSectionNavigation={false}
              />
            );
          }

          if (sectionId === "git") {
            return (
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
                integrationRows={integrationRows}
                integrationSaveError={null}
                isSubmittingIntegrationBindings={false}
                onAddIntegrationBindingRow={async (nextBinding) => {
                  setIntegrationRows((currentRows) => [
                    ...currentRows,
                    {
                      clientId: `row-${String(currentRows.length + 1)}`,
                      connectionId: nextBinding.connectionId,
                      kind: nextBinding.kind,
                      config: nextBinding.config,
                    },
                  ]);
                  return true;
                }}
                onIntegrationBindingRowChange={(clientId, changes) => {
                  setIntegrationRows((currentRows) =>
                    currentRows.map((row) =>
                      row.clientId === clientId ? { ...row, ...changes } : row,
                    ),
                  );
                }}
                onRemoveIntegrationBindingRow={(clientId) => {
                  setIntegrationRows((currentRows) =>
                    currentRows.filter((row) => row.clientId !== clientId),
                  );
                }}
                sectionKinds={["git"]}
                showSectionNavigation={false}
              />
            );
          }

          if (sectionId === "connector") {
            return (
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
                integrationRows={integrationRows}
                integrationSaveError={null}
                isSubmittingIntegrationBindings={false}
                onAddIntegrationBindingRow={async (nextBinding) => {
                  setIntegrationRows((currentRows) => [
                    ...currentRows,
                    {
                      clientId: `row-${String(currentRows.length + 1)}`,
                      connectionId: nextBinding.connectionId,
                      kind: nextBinding.kind,
                      config: nextBinding.config,
                    },
                  ]);
                  return true;
                }}
                onIntegrationBindingRowChange={(clientId, changes) => {
                  setIntegrationRows((currentRows) =>
                    currentRows.map((row) =>
                      row.clientId === clientId ? { ...row, ...changes } : row,
                    ),
                  );
                }}
                onRemoveIntegrationBindingRow={(clientId) => {
                  setIntegrationRows((currentRows) =>
                    currentRows.filter((row) => row.clientId !== clientId),
                  );
                }}
                sectionKinds={["connector"]}
                showSectionNavigation={false}
              />
            );
          }

          return (
            <SandboxProfileSetupScriptPanel
              onBlur={handleSetupScriptBlur}
              onChange={setSetupScriptDraft}
              saveStatus={setupScriptSaveStatus}
              value={setupScriptDraft}
            />
          );
        }}
        sections={StorySections}
      />
    </QueryClientProvider>
  );
}

function SandboxProfileEditorPageStory(
  input: SandboxProfileEditorPageStoryArgs,
): React.JSX.Element {
  const [router] = useState(() =>
    createMemoryRouter(
      createRoutesFromElements(
        <Route element={<SandboxProfileEditorPageStoryView {...input} />} path="/" />,
      ),
      {
        initialEntries: ["/"],
      },
    ),
  );

  return <RouterProvider router={router} />;
}

const meta = {
  title: "Dashboard/SandboxProfiles/Editor/Page",
  component: SandboxProfileEditorPageStory,
  decorators: [withDashboardPageStory],
  render: function RenderStory(args): React.JSX.Element {
    return <SandboxProfileEditorPageStory {...args} />;
  },
  args: {
    displayName: "Customer Support Sandbox",
    setupScript: `#!/usr/bin/env bash
set -euo pipefail

pnpm install
pnpm dev:bootstrap`,
  },
} satisfies Meta<typeof SandboxProfileEditorPageStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ConfigurationsSelected: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole("tab", { name: "Configurations" }));
  },
};

export const EmptySetupScript: Story = {
  args: {
    setupScript: null,
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole("tab", { name: "Configurations" }));
  },
};
