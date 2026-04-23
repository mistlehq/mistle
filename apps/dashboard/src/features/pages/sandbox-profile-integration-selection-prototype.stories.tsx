import { Badge, Button, SectionBlock, Switch } from "@mistle/ui";
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
  actionLabel: string;
  hasConnection: boolean;
  id: string;
  logoKey: string | undefined;
  title: React.ReactNode;
};

function IntegrationTile(input: {
  item: IntegrationChoice;
  checked: boolean;
  onCheckedChange: (nextChecked: boolean) => void;
}): React.JSX.Element {
  const leading =
    input.item.logoKey === undefined ? undefined : (
      <img
        alt=""
        className="h-5 w-5 rounded-sm"
        src={resolveIntegrationLogoPath({ logoKey: input.item.logoKey })}
      />
    );

  return (
    <ActionTile
      action={
        input.item.hasConnection ? (
          <Switch
            aria-label={`Enable ${input.item.actionLabel}`}
            checked={input.checked}
            onCheckedChange={(value) => {
              input.onCheckedChange(value === true);
            }}
          />
        ) : (
          <Button className="px-0" type="button" variant="link">
            Add a connection to enable
          </Button>
        )
      }
      description=""
      leading={leading}
      title={input.item.title}
    />
  );
}

const ConnectedConnectorChoices: readonly IntegrationChoice[] = [
  {
    id: StoryLinearTarget.targetKey,
    actionLabel: StoryLinearTarget.displayName,
    title: StoryLinearTarget.displayName,
    logoKey: StoryLinearTarget.logoKey,
    hasConnection: true,
  },
  {
    id: StorySlackTarget.targetKey,
    actionLabel: StorySlackTarget.displayName,
    title: StorySlackTarget.displayName,
    logoKey: StorySlackTarget.logoKey,
    hasConnection: true,
  },
  {
    id: StoryJiraTarget.targetKey,
    actionLabel: StoryJiraTarget.displayName,
    title: StoryJiraTarget.displayName,
    logoKey: StoryJiraTarget.logoKey,
    hasConnection: true,
  },
  {
    id: StoryAwsTarget.targetKey,
    actionLabel: StoryAwsTarget.displayName,
    title: StoryAwsTarget.displayName,
    logoKey: StoryAwsTarget.logoKey,
    hasConnection: true,
  },
] as const;

const DisconnectedConnectorChoices: readonly IntegrationChoice[] = [
  {
    id: StoryDatadogTarget.targetKey,
    actionLabel: StoryDatadogTarget.displayName,
    title: StoryDatadogTarget.displayName,
    logoKey: StoryDatadogTarget.logoKey,
    hasConnection: false,
  },
  {
    id: StoryPlanetScaleTarget.targetKey,
    actionLabel: StoryPlanetScaleTarget.displayName,
    title: StoryPlanetScaleTarget.displayName,
    logoKey: StoryPlanetScaleTarget.logoKey,
    hasConnection: false,
  },
  {
    id: StorySignozTarget.targetKey,
    actionLabel: StorySignozTarget.displayName,
    title: StorySignozTarget.displayName,
    logoKey: StorySignozTarget.logoKey,
    hasConnection: false,
  },
] as const;

const ConnectorChoices = [...ConnectedConnectorChoices, ...DisconnectedConnectorChoices];

function SandboxProfileIntegrationSelectionPrototypeStory(): React.JSX.Element {
  const [profileName, setProfileName] = useState("Customer Support Sandbox");
  const [enabledChoices, setEnabledChoices] = useState<Readonly<Record<string, boolean>>>({
    codex: true,
    github: true,
    [StoryLinearTarget.targetKey]: true,
    [StorySlackTarget.targetKey]: true,
    [StoryJiraTarget.targetKey]: false,
    [StoryAwsTarget.targetKey]: false,
  });

  function setChoiceEnabled(id: string, nextChecked: boolean): void {
    setEnabledChoices((currentChoices) => ({
      ...currentChoices,
      [id]: nextChecked,
    }));
  }

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

        <SectionBlock title="Agent Harness">
          <div className="w-full max-w-6xl">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              <IntegrationTile
                checked
                item={{
                  id: "codex",
                  actionLabel: "Codex",
                  title: (
                    <span className="flex items-center gap-2">
                      <span>Codex</span>
                      <Badge variant="outline">Default</Badge>
                    </span>
                  ),
                  logoKey: StoryOpenAiTarget.logoKey,
                  hasConnection: true,
                }}
                onCheckedChange={() => {}}
              />
            </div>
          </div>
        </SectionBlock>

        <SectionBlock title="Git Provider">
          <div className="w-full max-w-6xl">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              <IntegrationTile
                checked={enabledChoices["github"] === true}
                item={{
                  id: "github",
                  actionLabel: StoryGithubTarget.displayName,
                  title: StoryGithubTarget.displayName,
                  logoKey: StoryGithubTarget.logoKey,
                  hasConnection: true,
                }}
                onCheckedChange={(nextChecked) => {
                  setChoiceEnabled("github", nextChecked);
                }}
              />
            </div>
          </div>
        </SectionBlock>

        <SectionBlock title="Connectors">
          <div className="w-full max-w-6xl">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {ConnectorChoices.map((item) => (
                <IntegrationTile
                  checked={enabledChoices[item.id] === true}
                  item={item}
                  key={item.id}
                  onCheckedChange={(nextChecked) => {
                    setChoiceEnabled(item.id, nextChecked);
                  }}
                />
              ))}
            </div>
          </div>
        </SectionBlock>
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
