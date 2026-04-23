import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldContent,
  FieldHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@mistle/ui";
import { InfoIcon, PencilSimpleIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type React from "react";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import { useIntegrationResourcePickerStoryState } from "../forms/integration-resource-picker-story-harness.js";
import {
  createGithubRepositoryResources,
  RepositoryItems,
} from "../forms/integration-resource-picker-story-support.js";
import { IntegrationResourcePickerView } from "../forms/integration-resource-picker-view.js";
import type { IntegrationConnectionResource } from "../integrations/integrations-service.js";
import { resolveIntegrationLogoPath } from "../integrations/logo.js";
import { ActionTile } from "../shared/action-tile.js";
import { AutoSaveTitleHeading } from "../shared/auto-save-inline-heading.js";
import { PageFrame } from "../shared/page-frame.js";
import {
  StoryAwsConnection,
  StoryAwsTarget,
  StoryDatadogTarget,
  StoryGithubConnection,
  StoryGithubTarget,
  StoryJiraConnection,
  StoryJiraTarget,
  StoryLinearConnection,
  StoryLinearTarget,
  StoryOpenAiTarget,
  StoryPlanetScaleTarget,
  StorySignozTarget,
  StorySlackConnection,
  StorySlackTarget,
} from "./integrations-editor-section-story-support.js";
import {
  SandboxProfileBindingConfigEditor,
  type IntegrationConnectionSummary,
  type IntegrationTargetSummary,
  type SandboxProfileBindingEditorRow,
} from "./sandbox-profile-binding-config-editor.js";
import { SandboxSetupScriptEditor } from "./sandbox-setup-script-editor.js";

const PrototypeTabs = [
  { value: "integrations", label: "Integrations" },
  { value: "resources-and-tools", label: "Resources & Tools" },
  { value: "configurations", label: "Configurations" },
] as const;

type PrototypeTabValue = (typeof PrototypeTabs)[number]["value"];

type IntegrationChoice = {
  availableConnections?: readonly {
    id: string;
    label: string;
  }[];
  id: string;
  logoKey: string | undefined;
  title: React.ReactNode;
  typeLabel: string;
};

type ToolOption = {
  id: string;
  label: string;
};

type IntegrationToolConfigSummary = {
  label: string;
  value: string;
};

type ConfigurationEditorContext = {
  integrationId: string;
  title: string;
  row: SandboxProfileBindingEditorRow;
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
};

type SandboxProfileIntegrationSelectionPrototypeStoryProps = {
  initialTab?: PrototypeTabValue;
};

const NoIntegrationValue = "none";

function IntegrationNameCell(input: { item: IntegrationChoice }): React.JSX.Element {
  const leading =
    input.item.logoKey === undefined ? null : (
      <img
        alt=""
        className="h-5 w-5 rounded-sm"
        src={resolveIntegrationLogoPath({ logoKey: input.item.logoKey })}
      />
    );

  return (
    <div className="flex items-center gap-2 text-sm">
      {leading}
      <div className="min-w-0 truncate font-medium">{input.item.title}</div>
    </div>
  );
}

function CredentialCell(input: {
  item: IntegrationChoice;
  selectedConnectionId: string | undefined;
  onConnectionChange: (nextConnectionId: string) => void;
}): React.JSX.Element {
  const hasSelectableConnections =
    input.item.availableConnections !== undefined && input.item.availableConnections.length > 0;
  const selectedConnectionLabel = input.item.availableConnections?.find(
    (connection) => connection.id === input.selectedConnectionId,
  )?.label;

  if (!hasSelectableConnections) {
    return (
      <Button className="px-0" type="button" variant="link">
        Add a connection to enable
      </Button>
    );
  }

  return (
    <Select
      onValueChange={(nextValue) => {
        input.onConnectionChange(nextValue ?? "");
      }}
      value={input.selectedConnectionId ?? null}
    >
      <SelectTrigger aria-label={`${input.item.id} connection`} className="w-full min-w-0">
        <SelectValue placeholder="Choose a connection">{selectedConnectionLabel}</SelectValue>
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        {input.item.availableConnections?.map((connection) => (
          <SelectItem key={connection.id} value={connection.id}>
            {connection.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function IntegrationSelectionCell(input: {
  choices: readonly IntegrationChoice[];
  selectedIntegrationId: string;
  onIntegrationChange: (nextIntegrationId: string) => void;
}): React.JSX.Element {
  const selectedIntegration = input.choices.find(
    (choice) => choice.id === input.selectedIntegrationId,
  );

  return (
    <Select
      onValueChange={(nextIntegrationId) => {
        if (nextIntegrationId === null) {
          return;
        }
        input.onIntegrationChange(nextIntegrationId);
      }}
      value={input.selectedIntegrationId}
    >
      <SelectTrigger aria-label="git provider integration" className="w-full min-w-0">
        <SelectValue placeholder="Choose an integration">
          {selectedIntegration === undefined ? (
            "None"
          ) : (
            <IntegrationNameCell item={selectedIntegration} />
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        <SelectItem value={NoIntegrationValue}>None</SelectItem>
        {input.choices.map((choice) => (
          <SelectItem key={choice.id} value={choice.id}>
            <div className="flex items-center gap-2">
              {choice.logoKey === undefined ? null : (
                <img
                  alt=""
                  className="h-5 w-5 rounded-sm"
                  src={resolveIntegrationLogoPath({ logoKey: choice.logoKey })}
                />
              )}
              <span>{choice.title}</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const ConnectedConnectorChoices: readonly IntegrationChoice[] = [
  {
    id: StoryLinearTarget.targetKey,
    availableConnections: [
      { id: "linear-workspace", label: "Linear Workspace" },
      { id: "linear-staging", label: "Linear Staging" },
    ],
    typeLabel: "Connector",
    title: StoryLinearTarget.displayName,
    logoKey: StoryLinearTarget.logoKey,
  },
  {
    id: StorySlackTarget.targetKey,
    availableConnections: [{ id: "slack-workspace", label: "Slack Workspace" }],
    typeLabel: "Connector",
    title: StorySlackTarget.displayName,
    logoKey: StorySlackTarget.logoKey,
  },
  {
    id: StoryJiraTarget.targetKey,
    availableConnections: [
      { id: "jira-production", label: "Jira Production" },
      { id: "jira-sandbox", label: "Jira Sandbox" },
    ],
    typeLabel: "Connector",
    title: StoryJiraTarget.displayName,
    logoKey: StoryJiraTarget.logoKey,
  },
  {
    id: StoryAwsTarget.targetKey,
    availableConnections: [{ id: "aws-production", label: "AWS Production" }],
    typeLabel: "Connector",
    title: StoryAwsTarget.displayName,
    logoKey: StoryAwsTarget.logoKey,
  },
] as const;

const DisconnectedConnectorChoices: readonly IntegrationChoice[] = [
  {
    id: StoryDatadogTarget.targetKey,
    typeLabel: "Connector",
    title: StoryDatadogTarget.displayName,
    logoKey: StoryDatadogTarget.logoKey,
  },
  {
    id: StoryPlanetScaleTarget.targetKey,
    typeLabel: "Connector",
    title: StoryPlanetScaleTarget.displayName,
    logoKey: StoryPlanetScaleTarget.logoKey,
  },
  {
    id: StorySignozTarget.targetKey,
    typeLabel: "Connector",
    title: StorySignozTarget.displayName,
    logoKey: StorySignozTarget.logoKey,
  },
] as const;

const ConnectorChoices = [...ConnectedConnectorChoices, ...DisconnectedConnectorChoices];

const CodexChoice: IntegrationChoice = {
  id: "codex",
  availableConnections: [
    { id: "openai-primary", label: "Primary OpenAI Workspace" },
    { id: "openai-backup", label: "Backup OpenAI Workspace" },
  ],
  typeLabel: "Agent Harness",
  title: (
    <span className="flex items-center gap-2">
      <span>Codex</span>
      <Badge variant="outline">Default</Badge>
    </span>
  ),
  logoKey: StoryOpenAiTarget.logoKey,
};

const CodexCredentialChoice: IntegrationChoice = {
  id: "codex",
  availableConnections: [
    { id: "openai-primary", label: "Primary OpenAI Workspace" },
    { id: "openai-backup", label: "Backup OpenAI Workspace" },
  ],
  typeLabel: "Agent Harness",
  title: "Codex",
  logoKey: StoryOpenAiTarget.logoKey,
};

const GitHubChoice: IntegrationChoice = {
  id: "github",
  availableConnections: [
    { id: "github-production", label: "GitHub Production" },
    { id: "github-staging", label: "GitHub Staging" },
  ],
  typeLabel: "Git Provider",
  title: (
    <span className="flex items-center gap-2">
      <span>{StoryGithubTarget.displayName}</span>
      <Badge variant="outline">Default</Badge>
    </span>
  ),
  logoKey: StoryGithubTarget.logoKey,
};

const GitHubCredentialChoice: IntegrationChoice = {
  id: "github",
  availableConnections: [
    { id: "github-production", label: "GitHub Production" },
    { id: "github-staging", label: "GitHub Staging" },
  ],
  typeLabel: "Git Provider",
  title: StoryGithubTarget.displayName,
  logoKey: StoryGithubTarget.logoKey,
};

const GitProviderChoices = [GitHubCredentialChoice] as const;
const DefaultGitHubConnectionId = GitHubCredentialChoice.availableConnections?.[0]?.id;

const RepositoryItemsByConnectionId: Readonly<
  Record<string, readonly IntegrationConnectionResource[]>
> = {
  "github-production": RepositoryItems,
  "github-staging": createGithubRepositoryResources({
    connectionId: "github-staging",
    items: RepositoryItems.slice(0, 5),
  }).items,
};

const ToolOptionsByIntegrationId: Readonly<Record<string, readonly ToolOption[]>> = {
  github: [{ id: "github-cli", label: "GitHub CLI" }],
  [StoryLinearTarget.targetKey]: [{ id: "linear-mcp", label: "Linear MCP" }],
  [StorySlackTarget.targetKey]: [{ id: "slack-mcp", label: "Slack MCP" }],
  [StoryJiraTarget.targetKey]: [{ id: "jira-cli", label: "Jira CLI" }],
  [StoryAwsTarget.targetKey]: [{ id: "aws-cli", label: "AWS CLI" }],
  [StoryPlanetScaleTarget.targetKey]: [
    { id: "planetscale-mcp", label: "PlanetScale MCP" },
    { id: "planetscale-insights-mcp", label: "PlanetScale Insights MCP" },
  ],
};

const ToolConfigSummaryByIntegrationId: Readonly<
  Record<string, readonly IntegrationToolConfigSummary[]>
> = {
  [StoryAwsTarget.targetKey]: [
    { label: "Services", value: "S3, STS, Secrets Manager" },
    { label: "Regions", value: "us-east-1, us-west-2" },
    { label: "Default region", value: "us-east-1" },
  ],
};

function AddConnectorTile(input: {
  item: IntegrationChoice;
  onAdd: (connectorId: string) => void;
}): React.JSX.Element {
  const leading =
    input.item.logoKey === undefined ? null : (
      <img alt="" src={resolveIntegrationLogoPath({ logoKey: input.item.logoKey })} />
    );
  const hasSelectableConnections =
    input.item.availableConnections !== undefined && input.item.availableConnections.length > 0;

  return (
    <ActionTile
      action={
        hasSelectableConnections ? (
          <Button
            onClick={() => {
              input.onAdd(input.item.id);
            }}
            type="button"
          >
            Add
          </Button>
        ) : (
          <Button className="px-0" type="button" variant="link">
            Setup integration
          </Button>
        )
      }
      description=""
      leading={leading}
      title={input.item.title}
    />
  );
}

function ToolSelectionRow(input: {
  editAction?: React.ReactNode;
  integration: IntegrationChoice;
  selectedToolIds: ReadonlySet<string>;
  onToolToggle: (toolId: string, checked: boolean) => void;
}): React.JSX.Element {
  const leading =
    input.integration.logoKey === undefined ? null : (
      <img
        alt=""
        className="h-5 w-5 rounded-sm"
        src={resolveIntegrationLogoPath({ logoKey: input.integration.logoKey })}
      />
    );
  const toolOptions = ToolOptionsByIntegrationId[input.integration.id] ?? [];
  const configSummary = ToolConfigSummaryByIntegrationId[input.integration.id] ?? [];

  return (
    <div className="grid grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto] gap-4 border-b py-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm">
          {leading}
          <div className="min-w-0 truncate font-medium">{input.integration.title}</div>
        </div>
      </div>
      <div className="min-w-0">
        <div className="flex flex-col gap-2">
          {configSummary.length === 0 ? null : (
            <div className="mb-1 flex flex-col gap-2">
              {configSummary.map((item) => (
                <div className="flex flex-col gap-0.5" key={item.label}>
                  <p className="text-muted-foreground text-xs uppercase tracking-wide">
                    {item.label}
                  </p>
                  <p className="text-sm">{item.value}</p>
                </div>
              ))}
            </div>
          )}
          {toolOptions.map((tool) => (
            <label className="flex items-center gap-2 text-sm" key={tool.id}>
              <Checkbox
                aria-label={tool.label}
                checked={input.selectedToolIds.has(tool.id)}
                onCheckedChange={(checked) => {
                  input.onToolToggle(tool.id, checked === true);
                }}
              />
              <span>{tool.label}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="flex w-8 shrink-0 items-start justify-end">{input.editAction}</div>
    </div>
  );
}

function RepositoryResourcePicker(input: {
  connectionId: string;
  items: readonly IntegrationConnectionResource[];
}): React.JSX.Element {
  const storyState = useIntegrationResourcePickerStoryState({
    items: input.items,
    title: "Repositories",
    refreshLabel: "Refresh repositories",
    syncMetadata: "Last synced Mar 9, 2026, 12:00 PM",
    emptyMessage: "No repositories available for this connection.",
    initialSelectedHandles: input.items.slice(0, 2).map((item) => item.handle),
  });

  return (
    <IntegrationResourcePickerView
      emptyMessage={storyState.viewModel.emptyMessage}
      id={`repository-resources-${input.connectionId}`}
      isRefreshing={false}
      label="Repositories"
      listState={{ mode: "ready", items: storyState.visibleItems }}
      onBlur={() => {}}
      onFocus={() => {}}
      onRefresh={() => {}}
      onSearchChange={storyState.setSearch}
      onSelectionChange={storyState.setSelectedHandles}
      onToggleAll={storyState.toggleAll}
      refreshErrorMessage={null}
      refreshLabel="Refresh repositories"
      refreshTooltip={storyState.viewModel.refreshTooltip}
      search={storyState.search}
      searchPlaceholder="Add repositories"
      selectedHandles={storyState.selectedHandles}
      unavailableSelectedHandles={[]}
      visibleItems={storyState.visibleItems}
    />
  );
}

function SandboxProfileIntegrationSelectionPrototypeStory(
  input: SandboxProfileIntegrationSelectionPrototypeStoryProps,
): React.JSX.Element {
  const [profileName, setProfileName] = useState("Customer Support Sandbox");
  const [activeTab, setActiveTab] = useState<PrototypeTabValue>(input.initialTab ?? "integrations");
  const [isAddConnectorsDialogOpen, setIsAddConnectorsDialogOpen] = useState(false);
  const [isAwsConfigDialogOpen, setIsAwsConfigDialogOpen] = useState(false);
  const [selectedGitProviderId, setSelectedGitProviderId] = useState(GitHubChoice.id);
  const [selectedConnections, setSelectedConnections] = useState<Readonly<Record<string, string>>>({
    codex: "openai-primary",
    ...(DefaultGitHubConnectionId === undefined ? {} : { github: DefaultGitHubConnectionId }),
    [StoryLinearTarget.targetKey]: "linear-workspace",
    [StorySlackTarget.targetKey]: "slack-workspace",
  });
  const [selectedToolIdsByIntegrationId, setSelectedToolIdsByIntegrationId] = useState<
    Readonly<Record<string, readonly string[]>>
  >({
    github: ["github-cli"],
    [StoryAwsTarget.targetKey]: ["aws-cli"],
    [StoryJiraTarget.targetKey]: ["jira-cli"],
    [StoryLinearTarget.targetKey]: ["linear-mcp"],
    [StorySlackTarget.targetKey]: ["slack-mcp"],
  });
  const [configByIntegrationId, setConfigByIntegrationId] = useState<
    Readonly<Record<string, Record<string, unknown>>>
  >({
    [StoryAwsTarget.targetKey]: {
      services: ["s3", "sts", "secretsmanager"],
      regions: ["us-east-1", "us-west-2"],
      defaultRegion: "us-east-1",
      tools: ["aws-cli"],
    },
  });
  const [setupScript, setSetupScript] = useState("");

  function setSelectedConnection(id: string, nextConnectionId: string): void {
    setSelectedConnections((currentChoices) => ({
      ...currentChoices,
      [id]: nextConnectionId,
    }));
  }

  function addConnector(id: string): void {
    const connector = ConnectorChoices.find((item) => item.id === id);
    const defaultConnectionId = connector?.availableConnections?.[0]?.id;
    if (defaultConnectionId === undefined) {
      return;
    }

    setSelectedConnections((currentChoices) => ({
      ...currentChoices,
      [id]: defaultConnectionId,
    }));
  }

  function removeConnector(id: string): void {
    setSelectedConnections((currentChoices) => {
      const nextChoices = { ...currentChoices };
      delete nextChoices[id];
      return nextChoices;
    });
    setSelectedToolIdsByIntegrationId((currentToolIdsByIntegrationId) => {
      const nextToolIdsByIntegrationId = { ...currentToolIdsByIntegrationId };
      delete nextToolIdsByIntegrationId[id];
      return nextToolIdsByIntegrationId;
    });
  }

  function setSelectedGitProvider(nextIntegrationId: string): void {
    setSelectedGitProviderId(nextIntegrationId);
    if (nextIntegrationId === NoIntegrationValue) {
      setSelectedConnections((currentChoices) => {
        const nextChoices = { ...currentChoices };
        delete nextChoices.github;
        return nextChoices;
      });
      return;
    }

    const defaultConnectionId = DefaultGitHubConnectionId;
    if (defaultConnectionId === undefined) {
      return;
    }

    setSelectedConnections((currentChoices) => ({
      ...currentChoices,
      [nextIntegrationId]: currentChoices[nextIntegrationId] ?? defaultConnectionId,
    }));
  }

  function toggleTool(integrationId: string, toolId: string, checked: boolean): void {
    setSelectedToolIdsByIntegrationId((currentToolIdsByIntegrationId) => {
      const currentToolIds = currentToolIdsByIntegrationId[integrationId] ?? [];
      const nextToolIds = checked
        ? currentToolIds.includes(toolId)
          ? currentToolIds
          : [...currentToolIds, toolId]
        : currentToolIds.filter((currentToolId) => currentToolId !== toolId);
      return {
        ...currentToolIdsByIntegrationId,
        [integrationId]: nextToolIds,
      };
    });
    if (integrationId === StoryAwsTarget.targetKey) {
      setConfigByIntegrationId((currentConfigByIntegrationId) => {
        const currentConfig = currentConfigByIntegrationId[integrationId] ?? {};
        const currentToolIds = Array.isArray(currentConfig.tools)
          ? currentConfig.tools.filter((value): value is string => typeof value === "string")
          : [];
        const nextToolIds = checked
          ? currentToolIds.includes(toolId)
            ? currentToolIds
            : [...currentToolIds, toolId]
          : currentToolIds.filter((currentToolId) => currentToolId !== toolId);
        return {
          ...currentConfigByIntegrationId,
          [integrationId]: {
            ...currentConfig,
            tools: nextToolIds,
          },
        };
      });
    }
  }

  const selectedConnectorChoices = ConnectorChoices.filter(
    (item) => selectedConnections[item.id] !== undefined,
  );
  const addConnectorChoices = ConnectorChoices.filter(
    (item) => selectedConnections[item.id] === undefined,
  );
  const selectedGitConnectionId =
    selectedGitProviderId === NoIntegrationValue
      ? undefined
      : selectedConnections[selectedGitProviderId];
  const repositoryOptions =
    selectedGitConnectionId === undefined
      ? []
      : (RepositoryItemsByConnectionId[selectedGitConnectionId] ?? []);
  const configurationEditorContext = resolveConfigurationEditorContext({
    activeIntegrationId: StoryAwsTarget.targetKey,
    configByIntegrationId,
    selectedConnections,
  });
  const toolRowChoices = [
    ...(selectedGitProviderId === NoIntegrationValue ? [] : [GitHubCredentialChoice]),
    ...selectedConnectorChoices.filter(
      (item) => (ToolOptionsByIntegrationId[item.id] ?? []).length > 0,
    ),
  ];

  return (
    <PageFrame maxWidthClassName="max-w-5xl" title="">
      <div className="flex flex-col gap-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
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

        <div className="flex flex-col gap-6 md:grid md:grid-cols-[10rem_1px_minmax(0,1fr)] md:gap-0 lg:grid-cols-[11rem_1px_minmax(0,1fr)]">
          <div aria-label="Setup sections" className="hidden flex-col md:flex" role="tablist">
            {PrototypeTabs.map((tab) => (
              <button
                aria-controls={`sandbox-profile-setup-panel-${tab.value}`}
                aria-selected={tab.value === activeTab}
                className={`flex w-full items-start border-l-2 py-3 pl-4 pr-3 text-left text-sm font-medium leading-tight transition-colors ${
                  tab.value === activeTab
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
                id={`sandbox-profile-setup-tab-${tab.value}`}
                key={tab.value}
                onClick={() => setActiveTab(tab.value)}
                role="tab"
                tabIndex={tab.value === activeTab ? 0 : -1}
                type="button"
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div aria-hidden className="hidden self-stretch bg-border md:block md:w-px" />

          <div className="flex min-w-0 flex-1 flex-col gap-4 md:pl-8">
            <div
              aria-labelledby="sandbox-profile-setup-tab-integrations"
              className="w-full"
              hidden={activeTab !== "integrations"}
              id="sandbox-profile-setup-panel-integrations"
              role="tabpanel"
            >
              <div className="max-w-5xl">
                <div className="flex flex-col">
                  <div className="text-muted-foreground grid grid-cols-[10rem_minmax(0,1fr)_minmax(0,1fr)_2rem] gap-6 border-b py-2 text-xs uppercase tracking-wide">
                    <div className="min-w-0">
                      <p>Type</p>
                    </div>
                    <div className="min-w-0">
                      <p>Integration</p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p>Connection</p>
                    </div>
                    <div className="w-8 shrink-0" />
                  </div>
                  {[
                    {
                      id: "codex",
                      item: CodexChoice,
                      credentialItem: CodexCredentialChoice,
                    },
                    {
                      id: "github",
                      item: GitHubChoice,
                      credentialItem: GitHubCredentialChoice,
                    },
                    ...selectedConnectorChoices.map((item) => ({
                      id: item.id,
                      item,
                      credentialItem: item,
                    })),
                  ].map(({ id, item, credentialItem }) => (
                    <div
                      className="grid grid-cols-[10rem_minmax(0,1fr)_minmax(0,1fr)_2rem] items-center gap-6 border-b py-4"
                      key={id}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-primary">{item.typeLabel}</p>
                      </div>
                      <div className="min-w-0">
                        {id === GitHubChoice.id ? (
                          <IntegrationSelectionCell
                            choices={GitProviderChoices}
                            onIntegrationChange={(nextIntegrationId) => {
                              setSelectedGitProvider(nextIntegrationId);
                            }}
                            selectedIntegrationId={selectedGitProviderId}
                          />
                        ) : (
                          <IntegrationNameCell item={item} />
                        )}
                      </div>
                      <div className="min-w-0">
                        {id === GitHubChoice.id &&
                        selectedGitProviderId === NoIntegrationValue ? null : (
                          <CredentialCell
                            item={credentialItem}
                            onConnectionChange={(nextConnectionId) => {
                              setSelectedConnection(id, nextConnectionId);
                            }}
                            selectedConnectionId={selectedConnections[id]}
                          />
                        )}
                      </div>
                      <div className="flex w-8 shrink-0 justify-end">
                        {item.typeLabel === "Connector" ? (
                          <Button
                            aria-label="Remove connector"
                            className="h-7 w-7"
                            onClick={() => {
                              removeConnector(id);
                            }}
                            type="button"
                            variant="ghost"
                          >
                            <TrashIcon aria-hidden className="size-4" />
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-3 max-w-5xl">
                {addConnectorChoices.length === 0 ? null : (
                  <Button
                    className="px-0 text-sm"
                    onClick={() => {
                      setIsAddConnectorsDialogOpen(true);
                    }}
                    type="button"
                    variant="link"
                  >
                    <PlusIcon aria-hidden className="size-4" />
                    Add more connectors
                  </Button>
                )}
              </div>
            </div>

            <div
              aria-labelledby="sandbox-profile-setup-tab-resources-and-tools"
              className="w-full"
              hidden={activeTab !== "resources-and-tools"}
              id="sandbox-profile-setup-panel-resources-and-tools"
              role="tabpanel"
            >
              <div className="flex max-w-5xl flex-col gap-8">
                <div className="flex flex-col gap-3">
                  <p className="text-muted-foreground text-xs uppercase tracking-wide">
                    Repository Resources
                  </p>
                  {selectedGitConnectionId === undefined ? (
                    <p className="text-muted-foreground text-sm">
                      Choose a Git provider in Integrations before selecting repository resources.
                    </p>
                  ) : (
                    <RepositoryResourcePicker
                      connectionId={selectedGitConnectionId}
                      items={repositoryOptions}
                      key={selectedGitConnectionId}
                    />
                  )}
                </div>

                {toolRowChoices.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    Choose integrations with CLI tools in Integrations before selecting tools here.
                  </p>
                ) : (
                  <div className="flex flex-col">
                    <div className="text-muted-foreground grid grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto] gap-4 border-b py-2 text-xs uppercase tracking-wide">
                      <div className="min-w-0">
                        <p>Integration</p>
                      </div>
                      <div className="min-w-0">
                        <p>Tools</p>
                      </div>
                      <div className="w-8 shrink-0" />
                    </div>
                    {toolRowChoices.map((item) => {
                      if (selectedConnections[item.id] === undefined) {
                        return null;
                      }

                      return (
                        <ToolSelectionRow
                          editAction={
                            item.id === StoryAwsTarget.targetKey ? (
                              <Button
                                aria-label="Edit binding"
                                className="h-7 w-7"
                                onClick={() => {
                                  setIsAwsConfigDialogOpen(true);
                                }}
                                type="button"
                                variant="ghost"
                              >
                                <PencilSimpleIcon aria-hidden className="size-4" />
                              </Button>
                            ) : undefined
                          }
                          integration={item}
                          key={item.id}
                          onToolToggle={(toolId, checked) => {
                            toggleTool(item.id, toolId, checked);
                          }}
                          selectedToolIds={new Set(selectedToolIdsByIntegrationId[item.id] ?? [])}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div
              aria-labelledby="sandbox-profile-setup-tab-configurations"
              className="w-full"
              hidden={activeTab !== "configurations"}
              id="sandbox-profile-setup-panel-configurations"
              role="tabpanel"
            >
              <div className="max-w-5xl">
                <Field>
                  <FieldHeader>
                    <div className="flex items-center gap-1.5">
                      <p
                        className="text-muted-foreground text-xs uppercase tracking-wide"
                        id="sandbox-setup-script-label"
                      >
                        Setup script
                      </p>
                      <Tooltip delay={0}>
                        <TooltipTrigger
                          aria-label="Explain setup script"
                          render={
                            <button
                              className="text-muted-foreground hover:text-foreground inline-flex size-4 shrink-0 items-center justify-center rounded-sm"
                              type="button"
                            />
                          }
                        >
                          <InfoIcon aria-hidden className="size-3.5" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-64 text-left" side="top">
                          Runs once during sandbox setup after repositories, resources, and CLI
                          tools are ready. Use it for project bootstrap steps such as dependency
                          install, local config generation, or repo-specific setup commands.
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </FieldHeader>
                  <FieldContent>
                    <SandboxSetupScriptEditor
                      ariaLabelledBy="sandbox-setup-script-label"
                      onChange={setSetupScript}
                      placeholderText={`#!/usr/bin/env bash
set -euo pipefail

pnpm install
pnpm dev:bootstrap`}
                      value={setupScript}
                    />
                  </FieldContent>
                </Field>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Dialog
        onOpenChange={(nextOpen) => {
          setIsAddConnectorsDialogOpen(nextOpen);
        }}
        open={isAddConnectorsDialogOpen}
      >
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader variant="sectioned">
            <DialogTitle>Add connectors</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {addConnectorChoices.map((item) => (
              <AddConnectorTile
                item={item}
                key={item.id}
                onAdd={(connectorId) => {
                  addConnector(connectorId);
                }}
              />
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(nextOpen) => {
          setIsAwsConfigDialogOpen(nextOpen);
        }}
        open={isAwsConfigDialogOpen}
      >
        <DialogContent className="sm:max-w-4xl">
          <button autoFocus className="sr-only" type="button">
            AWS dialog
          </button>
          <DialogHeader variant="sectioned">
            <DialogTitle>AWS</DialogTitle>
          </DialogHeader>
          {configurationEditorContext === null ? null : (
            <SandboxProfileBindingConfigEditor
              availableConnections={configurationEditorContext.availableConnections}
              availableTargets={configurationEditorContext.availableTargets}
              formContext={{
                columns: 2,
                labelTone: "detail",
                layout: "vertical",
              }}
              onIntegrationBindingRowChange={(_clientId, changes) => {
                if (changes.config === undefined) {
                  return;
                }
                const nextConfig = Object.fromEntries(Object.entries(changes.config));

                setConfigByIntegrationId((currentConfigByIntegrationId) => ({
                  ...currentConfigByIntegrationId,
                  [configurationEditorContext.integrationId]: nextConfig,
                }));
                const nextTools = Array.isArray(nextConfig.tools)
                  ? nextConfig.tools.filter((value): value is string => typeof value === "string")
                  : undefined;
                if (nextTools !== undefined) {
                  setSelectedToolIdsByIntegrationId((currentToolIdsByIntegrationId) => ({
                    ...currentToolIdsByIntegrationId,
                    [configurationEditorContext.integrationId]: nextTools,
                  }));
                }
              }}
              row={configurationEditorContext.row}
            />
          )}
          <DialogFooter>
            <Button
              onClick={() => {
                setIsAwsConfigDialogOpen(false);
              }}
              type="button"
              variant="outline"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageFrame>
  );
}

function resolveConfigurationEditorContext(input: {
  activeIntegrationId: string | null;
  configByIntegrationId: Readonly<Record<string, Record<string, unknown>>>;
  selectedConnections: Readonly<Record<string, string>>;
}): ConfigurationEditorContext | null {
  if (input.activeIntegrationId !== StoryAwsTarget.targetKey) {
    return null;
  }

  const selectedConnectionId = input.selectedConnections[StoryAwsTarget.targetKey];
  if (selectedConnectionId === undefined) {
    return null;
  }

  return {
    integrationId: StoryAwsTarget.targetKey,
    title: "AWS",
    row: {
      clientId: "configuration-editor-aws",
      connectionId: selectedConnectionId,
      kind: "connector",
      config: input.configByIntegrationId[StoryAwsTarget.targetKey] ?? {
        services: ["s3", "sts", "secretsmanager"],
        regions: ["us-east-1", "us-west-2"],
        defaultRegion: "us-east-1",
        tools: ["aws-cli"],
      },
    },
    availableConnections: [
      {
        ...StoryAwsConnection,
        id: selectedConnectionId,
      },
      StoryGithubConnection,
      StoryJiraConnection,
      StoryLinearConnection,
      StorySlackConnection,
    ],
    availableTargets: [
      StoryAwsTarget,
      StoryGithubTarget,
      StoryJiraTarget,
      StoryLinearTarget,
      StorySlackTarget,
    ],
  };
}

/**
 * Prototype for choosing integrations first, using the existing section-header
 * structure and ActionTile styling instead of binding forms.
 */
const meta = {
  title: "Dashboard/SandboxProfiles/SetupFlow/IntegrationSelectionPrototype",
  component: SandboxProfileIntegrationSelectionPrototypeStory,
  decorators: [withDashboardPageStory],
} satisfies Meta<typeof SandboxProfileIntegrationSelectionPrototypeStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Integrations: Story = {
  args: {
    initialTab: "integrations",
  },
};

export const ResourcesAndTools: Story = {
  args: {
    initialTab: "resources-and-tools",
  },
};

export const Configurations: Story = {
  args: {
    initialTab: "configurations",
  },
};
