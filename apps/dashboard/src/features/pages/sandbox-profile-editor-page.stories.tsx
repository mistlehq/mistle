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
  StorySlackConnection,
} from "./integrations-editor-section-story-support.js";
import type {
  IntegrationConnectionSummary,
  IntegrationTargetSummary,
  SandboxProfileBindingEditorRow,
} from "./sandbox-profile-binding-config-editor.js";
import {
  SandboxProfileIntegrationsSetupUnavailableState,
  SandboxProfileEditorView,
  SandboxProfileSetupScriptPanel,
} from "./sandbox-profile-editor-page.js";
import type { SandboxProfileEditorSection } from "./sandbox-profile-editor-sections.js";
import { SandboxProfileIntegrationsSetupSection } from "./sandbox-profile-integrations-setup-section.js";
import { mapBindingsToEditorRows } from "./sandbox-profile-integrations-state.js";
import { SandboxProfileResourcesAndToolsSection } from "./sandbox-profile-resources-and-tools-section.js";

type SandboxProfileEditorPageStoryArgs = {
  displayName: string;
  availableConnections?: readonly IntegrationConnectionSummary[];
  availableTargets?: readonly IntegrationTargetSummary[];
  integrationsSectionState?: {
    bindingsErrorMessage?: string;
    directoryErrorMessage?: string;
    kind: "error";
  };
  initialBindings?: readonly {
    id: string;
    connectionId: string;
    kind: "agent" | "git" | "connector";
    config: Record<string, unknown>;
  }[];
  setupScript: string | null;
};

type IntegrationsSectionState = NonNullable<
  SandboxProfileEditorPageStoryArgs["integrationsSectionState"]
>;

const StorySections = [
  {
    id: "integrations",
    label: "Integrations",
  },
  {
    id: "resources-and-tools",
    label: "Resources & Tools",
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

function renderUnavailableIntegrationsSectionPanel(input: {
  sectionId: SandboxProfileEditorSection["id"];
  state: IntegrationsSectionState;
}): React.JSX.Element {
  return (
    <SandboxProfileIntegrationsSetupUnavailableState
      activeSectionId={input.sectionId}
      integrationBindingsError={
        input.state.bindingsErrorMessage === undefined
          ? null
          : new Error(input.state.bindingsErrorMessage)
      }
      integrationDirectoryError={
        input.state.directoryErrorMessage === undefined
          ? null
          : new Error(input.state.directoryErrorMessage)
      }
      isPending={false}
    />
  );
}

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
    () => mapBindingsToEditorRows(input.initialBindings ?? StoryBindings),
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
          if (
            input.integrationsSectionState !== undefined &&
            (sectionId === "integrations" || sectionId === "resources-and-tools")
          ) {
            return renderUnavailableIntegrationsSectionPanel({
              sectionId,
              state: input.integrationsSectionState,
            });
          }

          if (sectionId === "integrations") {
            return (
              <SandboxProfileIntegrationsSetupSection
                availableConnections={input.availableConnections ?? StoryIntegrationConnections}
                availableTargets={input.availableTargets ?? StoryIntegrationTargets}
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
                integrationRows={integrationRows}
                integrationSaveError={null}
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
              />
            );
          }

          if (sectionId === "resources-and-tools") {
            return (
              <SandboxProfileResourcesAndToolsSection
                availableConnections={input.availableConnections ?? StoryIntegrationConnections}
                availableTargets={input.availableTargets ?? StoryIntegrationTargets}
                onRowChange={(clientId, changes) => {
                  setIntegrationRows((currentRows) =>
                    currentRows.map((row) =>
                      row.clientId === clientId ? { ...row, ...changes } : row,
                    ),
                  );
                }}
                rows={integrationRows}
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

export const EmptySetupScript: Story = {
  args: {
    setupScript: null,
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole("tab", { name: "Configurations" }));
  },
};

export const ResourcesAndToolsLoadError: Story = {
  args: {
    integrationsSectionState: {
      kind: "error",
      bindingsErrorMessage: "Could not load sandbox profile integration bindings.",
      directoryErrorMessage: "Could not load integration connections.",
    },
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole("tab", { name: "Resources & Tools" }));
  },
};

export const StaleConnectorBinding: Story = {
  args: {
    initialBindings: [
      ...StoryBindings,
      {
        id: "binding-stale-connector",
        connectionId: "connection-missing",
        kind: "connector",
        config: {},
      },
    ],
  },
};

export const StaleConnectorMissingTarget: Story = {
  args: {
    availableConnections: StoryIntegrationConnections,
    availableTargets: StoryIntegrationTargets.filter(
      (target) => target.targetKey !== StorySlackConnection.targetKey,
    ),
    initialBindings: [
      ...StoryBindings,
      {
        id: "binding-stale-connector-missing-target",
        connectionId: StorySlackConnection.id,
        kind: "connector",
        config: {},
      },
    ],
  },
};

export const StaleGitProviderBinding: Story = {
  args: {
    initialBindings: [
      ...StoryBindings.filter((binding) => binding.kind !== "git"),
      {
        id: "binding-stale-git",
        connectionId: "missing-git-connection",
        kind: "git",
        config: {},
      },
    ],
  },
};

export const StaleGitProviderMissingTarget: Story = {
  args: {
    availableConnections: StoryIntegrationConnections,
    availableTargets: StoryIntegrationTargets.filter(
      (target) => target.targetKey !== StoryGithubConnection.targetKey,
    ),
    initialBindings: [
      ...StoryBindings,
      {
        id: "binding-stale-git-missing-target",
        connectionId: StoryGithubConnection.id,
        kind: "git",
        config: {},
      },
    ],
  },
};
