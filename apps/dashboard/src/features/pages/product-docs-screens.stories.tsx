import type { Meta, StoryObj } from "@storybook/react-vite";
import type React from "react";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import {
  ExistingScheduledAutomationValues,
  ScheduledAutomationFormStoryHarness,
} from "../automations/scheduled-automation-form.stories.js";
import {
  ExistingSlackAutomationValues,
  SlackWebhookEventOptions,
  WebhookAutomationFormStoryHarness,
} from "../automations/webhook-automation-form.stories.js";
import {
  IntegrationConnectionDetailView,
  type IntegrationConnectionDetailViewProps,
} from "../integrations/integration-connection-detail-view.js";
import {
  createGitHubAppDetailViewStoryProps,
  createSlackDetailViewStoryProps,
} from "../integrations/integration-story-harness.js";
import type { OrganizationSandboxStorageFormState } from "../settings/organization/sandbox-storage-model.js";
import { NewSessionPageStory } from "./new-session-page.stories.js";
import {
  OrganizationIdentityLinkingSettingsPageView,
  type OrganizationIdentityLinkingProviderRow,
} from "./organization-identity-linking-settings-page-view.js";
import {
  createDraftGitHubConnection,
  GitHubAppSetupPageStory,
} from "./organization-integrations-settings-github-app-flows.stories.js";
import {
  createDraftSlackConnection,
  SlackAppSetupPageStory,
} from "./organization-integrations-settings-slack-app-flows.stories.js";
import { OrganizationSandboxStorageSettingsPageView } from "./organization-sandbox-storage-settings-page-view.js";
import {
  ProfileSettingsLinkedAccountsSection,
  type ProfileSettingsLinkedAccountsSectionProps,
} from "./profile-settings-page-view.js";
import {
  DefaultProfileSettingsLinkedAccountsSectionProps,
  GitHubLinkedWithSigningNotConfiguredCard,
  SlackNotLinkedCard,
} from "./profile-settings-page-view.story-fixtures.js";
import {
  DefaultSandboxProfileEditorStoryArgs,
  SandboxProfileEditorPageStory,
  StoryBindings,
} from "./sandbox-profile-editor-story-support.js";
import { buildStoryLaunchableSandboxProfile } from "./sessions-page.story-fixtures.js";

const IdentityLinkingProviders: OrganizationIdentityLinkingProviderRow[] = [
  {
    providerFamily: "github",
    displayName: "GitHub",
    logoKey: "github",
    connectionOptions: [
      {
        id: "conn_github_engineering",
        label: "GitHub Engineering",
      },
      {
        id: "conn_github_platform",
        label: "GitHub Platform",
      },
    ],
    selectedConnectionId: "conn_github_engineering",
    connectionPending: false,
    enablePending: false,
    enabled: true,
    linkedUsersCount: 12,
    memberLinksLoading: false,
    memberLinksErrorMessage: null,
    memberLinks: [
      {
        userId: "usr_owner",
        name: "Owner User",
        email: "owner@example.com",
        statusLabel: "Linked",
        principalSummary: "owner-github",
        updatedAt: "2026-04-20T00:00:00.000Z",
      },
      {
        userId: "usr_member",
        name: "Member User",
        email: "member@example.com",
        statusLabel: "Not linked",
        principalSummary: null,
        updatedAt: null,
      },
    ],
  },
  {
    providerFamily: "slack",
    displayName: "Slack",
    logoKey: "slack",
    connectionOptions: [
      {
        id: "conn_slack_workspace",
        label: "Slack Workspace",
      },
    ],
    selectedConnectionId: "conn_slack_workspace",
    connectionPending: false,
    enablePending: false,
    enabled: true,
    linkedUsersCount: 3,
    memberLinksLoading: false,
    memberLinksErrorMessage: null,
    memberLinks: [
      {
        userId: "usr_slack_admin",
        name: "Slack Admin",
        email: "admin@example.com",
        statusLabel: "Linked",
        principalSummary: "mistle-workspace",
        updatedAt: "2026-04-22T09:15:00.000Z",
      },
    ],
  },
];

const ProfileLinkedAccountsProps: ProfileSettingsLinkedAccountsSectionProps = {
  ...DefaultProfileSettingsLinkedAccountsSectionProps,
  linkedAccountCards: [GitHubLinkedWithSigningNotConfiguredCard, SlackNotLinkedCard],
};

const OrganizationSandboxStorageState: OrganizationSandboxStorageFormState = {
  persistentSandboxesEnabled: true,
  storageConfigSource: "organization",
  region: "aws-us-east-1",
  namePrefix: "mistle",
  apiKey: "archil-api-key",
  apiKeyConfigured: false,
  bucket: "mistle-sandboxes",
  endpoint: "https://storage.archil.example.com",
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "secret-access-key",
  secretAccessKeyConfigured: false,
};

function DocsProductScreen(input: { children: React.ReactNode }): React.JSX.Element {
  return <div className="min-h-screen bg-background">{input.children}</div>;
}

function IdentityLinkingOrganizationSettingsStory(): React.JSX.Element {
  return (
    <DocsProductScreen>
      <OrganizationIdentityLinkingSettingsPageView
        loadErrorMessage={null}
        onEnabledChange={async () => {}}
        onProviderConnectionChange={async () => {}}
        providers={IdentityLinkingProviders}
      />
    </DocsProductScreen>
  );
}

function IdentityLinkingProfileSettingsStory(): React.JSX.Element {
  return (
    <DocsProductScreen>
      <ProfileSettingsLinkedAccountsSection {...ProfileLinkedAccountsProps} />
    </DocsProductScreen>
  );
}

const InstalledConnectionTitleEditor: NonNullable<
  IntegrationConnectionDetailViewProps["titleEditor"]
> = {
  disabled: false,
  errorMessageByConnectionId: {},
  onStartEditing: () => {},
  onSave: async () => {},
};

function InstalledConnectionScreen(input: {
  detailViewProps: IntegrationConnectionDetailViewProps;
}): React.JSX.Element {
  return (
    <DocsProductScreen>
      <div className="mx-auto max-w-5xl px-6 py-8">
        <IntegrationConnectionDetailView
          {...input.detailViewProps}
          onCreateWebhookSource={() => {}}
          onDeleteWebhookSource={() => {}}
          onEditAuthentication={() => {}}
          onRefreshResource={() => {}}
          onStartGitHubAppInstallation={async () => {}}
          titleEditor={InstalledConnectionTitleEditor}
        />
      </div>
    </DocsProductScreen>
  );
}

function GitHubInstalledConnectionStory(): React.JSX.Element {
  return <InstalledConnectionScreen detailViewProps={createGitHubAppDetailViewStoryProps()} />;
}

function SlackInstalledConnectionStory(): React.JSX.Element {
  return <InstalledConnectionScreen detailViewProps={createSlackDetailViewStoryProps()} />;
}

function SandboxProfileDraftStory(): React.JSX.Element {
  return (
    <SandboxProfileEditorPageStory
      {...DefaultSandboxProfileEditorStoryArgs}
      initialBindings={[StoryBindings[0], StoryBindings[1], StoryBindings[2]]}
    />
  );
}

function SandboxProfileSetupScriptStory(): React.JSX.Element {
  return (
    <SandboxProfileEditorPageStory
      {...DefaultSandboxProfileEditorStoryArgs}
      initialBindings={[StoryBindings[0], StoryBindings[1]]}
      setupAssistantState="available"
      setupScriptTestStatus="success"
    />
  );
}

function SandboxProfileSnapshotReadyStory(): React.JSX.Element {
  return (
    <SandboxProfileEditorPageStory
      {...DefaultSandboxProfileEditorStoryArgs}
      initialSectionId="snapshot"
      lifecycleState="published"
      snapshotRefreshScheduleState="existing"
      snapshotState="snapshot-ready"
    />
  );
}

function NewSessionCreationStory(): React.JSX.Element {
  return (
    <NewSessionPageStory
      initialSelectedProfileId="sbp_profile_multi_repo"
      launchableProfiles={[
        buildStoryLaunchableSandboxProfile({
          id: "sbp_profile_multi_repo",
          displayName: "Engineering Sandbox",
          repositoryOptions: [
            {
              id: "/root/acme/platform",
              label: "acme/platform",
              path: "/root/acme/platform",
            },
            {
              id: "/root/acme/dashboard",
              label: "acme/dashboard",
              path: "/root/acme/dashboard",
            },
          ],
        }),
        buildStoryLaunchableSandboxProfile({
          id: "sbp_profile_general",
          displayName: "General Sandbox",
          latestVersion: 4,
        }),
      ]}
    />
  );
}

function EventAutomationStory(): React.JSX.Element {
  return (
    <WebhookAutomationFormStoryHarness
      mode="edit"
      onDelete={() => {}}
      values={ExistingSlackAutomationValues}
      webhookEventOptions={SlackWebhookEventOptions}
    />
  );
}

function ScheduledAutomationStory(): React.JSX.Element {
  return (
    <ScheduledAutomationFormStoryHarness
      mode="edit"
      onDelete={() => {}}
      primaryRepositoryOptions={[
        {
          value: "mistlehq/platform",
          label: "mistlehq/platform",
          path: "/root/mistlehq/platform",
        },
      ]}
      values={ExistingScheduledAutomationValues}
    />
  );
}

function PersistentSandboxesOrganizationSettingsStory(): React.JSX.Element {
  return (
    <DocsProductScreen>
      <OrganizationSandboxStorageSettingsPageView
        state={OrganizationSandboxStorageState}
        isSaving={false}
        loadErrorMessage={null}
        saveErrorMessage={null}
        visibleErrors={{}}
        onPersistentSandboxesEnabledChange={async () => {}}
        onStateChange={() => {}}
      />
    </DocsProductScreen>
  );
}

/**
 * Public docs screenshot source. Capture these stories when updating the Mintlify
 * guides so docs images stay grounded in real dashboard page components and stable
 * Storybook fixtures.
 */
const meta = {
  title: "Product Screens/Docs",
  decorators: [withDashboardPageStory],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const IdentityLinkingOrganizationSettings: Story = {
  render: IdentityLinkingOrganizationSettingsStory,
};

export const IdentityLinkingProfileSettings: Story = {
  render: IdentityLinkingProfileSettingsStory,
};

export const GitHubCreateFromManifest: Story = {
  render: function RenderStory() {
    return <GitHubAppSetupPageStory connection={createDraftGitHubConnection()} />;
  },
};

export const GitHubInstalledConnection: Story = {
  render: GitHubInstalledConnectionStory,
};

export const SlackCreateFromManifest: Story = {
  render: function RenderStory() {
    return <SlackAppSetupPageStory connection={createDraftSlackConnection()} />;
  },
};

export const SlackInstalledConnection: Story = {
  render: SlackInstalledConnectionStory,
};

export const SandboxProfileDraft: Story = {
  render: SandboxProfileDraftStory,
};

export const SandboxProfileSetupScript: Story = {
  render: SandboxProfileSetupScriptStory,
};

export const SandboxProfileSnapshotReady: Story = {
  render: SandboxProfileSnapshotReadyStory,
};

export const NewSessionCreation: Story = {
  render: NewSessionCreationStory,
};

export const EventAutomation: Story = {
  render: EventAutomationStory,
};

export const ScheduledAutomation: Story = {
  render: ScheduledAutomationStory,
};

export const PersistentSandboxesOrganizationSettings: Story = {
  render: PersistentSandboxesOrganizationSettingsStory,
};
