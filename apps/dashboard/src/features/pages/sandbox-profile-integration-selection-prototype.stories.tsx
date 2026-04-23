import {
  Badge,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@mistle/ui";
import { TrashIcon } from "@phosphor-icons/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type React from "react";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import { resolveIntegrationLogoPath } from "../integrations/logo.js";
import { ActionTile } from "../shared/action-tile.js";
import { AutoSaveTitleHeading } from "../shared/auto-save-inline-heading.js";
import { PageFrame } from "../shared/page-frame.js";
import {
  StoryAwsTarget,
  StoryDatadogTarget,
  StoryGithubTarget,
  StoryJiraTarget,
  StoryLinearTarget,
  StoryOpenAiTarget,
  StoryPlanetScaleTarget,
  StorySignozTarget,
  StorySlackTarget,
} from "./integrations-editor-section-story-support.js";

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
      <div className="min-w-0 font-medium">{input.item.title}</div>
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
      <SelectTrigger aria-label={`${input.item.id} connection`} className="w-full min-w-[14rem]">
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

function SandboxProfileIntegrationSelectionPrototypeStory(): React.JSX.Element {
  const [profileName, setProfileName] = useState("Customer Support Sandbox");
  const [selectedConnections, setSelectedConnections] = useState<Readonly<Record<string, string>>>({
    codex: "openai-primary",
    github: "github-production",
    [StoryLinearTarget.targetKey]: "linear-workspace",
    [StorySlackTarget.targetKey]: "slack-workspace",
  });

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
  }

  const selectedConnectorChoices = ConnectorChoices.filter(
    (item) => selectedConnections[item.id] !== undefined,
  );
  const addConnectorChoices = ConnectorChoices.filter(
    (item) => selectedConnections[item.id] === undefined,
  );

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

        <div className="max-w-5xl overflow-x-auto">
          <div className="flex min-w-[58rem] flex-col">
            <div className="text-muted-foreground flex gap-6 border-b py-2 text-sm uppercase tracking-wide">
              <div className="w-44 shrink-0">
                <p>Type</p>
              </div>
              <div className="w-56 shrink-0">
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
              <div className="flex items-center gap-6 border-b py-4" key={id}>
                <div className="w-44 shrink-0 min-w-0">
                  <p className="text-muted-foreground text-sm font-medium">{item.typeLabel}</p>
                </div>
                <div className="w-56 shrink-0 min-w-0">
                  <IntegrationNameCell item={item} />
                </div>
                <div className="min-w-0 flex-1">
                  <CredentialCell
                    item={credentialItem}
                    onConnectionChange={(nextConnectionId) => {
                      setSelectedConnection(id, nextConnectionId);
                    }}
                    selectedConnectionId={selectedConnections[id]}
                  />
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

        <div className="max-w-5xl">
          <div className="flex items-center gap-4">
            <h2 className="text-base font-semibold uppercase tracking-wide">Add Connectors</h2>
            <div className="h-px flex-1 bg-border" />
          </div>
          <div className="mt-4 w-full max-w-6xl">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
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
          </div>
        </div>
      </div>
    </PageFrame>
  );
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

export const Default: Story = {};
