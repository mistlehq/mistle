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
import { noopRespondToServerRequest } from "../chat/components/chat-story-support.js";
import {
  IntegrationConnectionDetailView,
  type IntegrationConnectionDetailViewProps,
} from "../integrations/integration-connection-detail-view.js";
import {
  createGitHubAppDetailViewStoryProps,
  createSlackDetailViewStoryProps,
} from "../integrations/integration-story-harness.js";
import {
  CodexFixtureSessionEntriesWithExploringGroup,
  SessionComposerFixtureProps,
} from "../session-agents/codex/fixtures/session-fixtures.js";
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
import { SessionConversationBottomPanel } from "./session-conversation-pane.js";
import {
  buildPendingSessionDiffCommentSummaryLabel,
  buildPendingSessionDiffCommentSummaryTitle,
  type PendingSessionDiffComment,
} from "./session-diff-comment.js";
import { SessionDiffPanel } from "./session-diff-panel.js";
import { SessionPortAccessPopover, SessionPortAccessSheet } from "./session-port-access-popover.js";
import {
  createStorySessionMainContent,
  renderSessionWorkbenchStory,
  renderSessionWorkbenchStoryWithChrome,
} from "./session-story-support.js";
import { SessionWorkbenchHeaderActions } from "./session-workbench-header-actions.js";
import { buildStoryLaunchableSandboxProfile } from "./sessions-page.story-fixtures.js";
import type { SessionPortAccessState } from "./use-session-port-access.js";

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

function DocsSessionScreen(input: {
  children: React.ReactNode;
  height: number;
  name: string;
  width: number;
}): React.JSX.Element {
  return (
    <div className="min-h-screen bg-background p-0">
      <div
        data-docs-screenshot={input.name}
        className="overflow-hidden bg-background"
        style={{
          width: input.width,
          height: input.height,
        }}
      >
        {input.children}
      </div>
    </div>
  );
}

const DocsSessionBranchPatch = [
  "diff --git a/apps/dashboard/src/features/pages/session-workbench-header-actions.tsx b/apps/dashboard/src/features/pages/session-workbench-header-actions.tsx",
  "index 96a64a1..b47f1d8 100644",
  "--- a/apps/dashboard/src/features/pages/session-workbench-header-actions.tsx",
  "+++ b/apps/dashboard/src/features/pages/session-workbench-header-actions.tsx",
  "@@ -1,5 +1,6 @@",
  ' import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@mistle/ui";',
  '+import { DotsThreeIcon } from "@phosphor-icons/react";',
  " ",
  "@@ -38,6 +44,7 @@ export function SessionWorkbenchHeaderActions(input: {",
  "   cliControl: SessionWorkbenchHeaderButtonControl;",
  "   diffControl: SessionWorkbenchHeaderButtonControl;",
  "+  mobilePortAccessControl?: SessionWorkbenchHeaderMobilePortAccessControl;",
  "   portAccessControl?: React.ReactNode;",
  "   terminalControl: SessionWorkbenchHeaderButtonControl;",
  " }): React.JSX.Element {",
  "@@ -86,6 +93,13 @@ export function SessionWorkbenchHeaderActions(input: {",
  '       <Button aria-label="TUI">TUI</Button>',
  "       {desktopPortAccessControl}",
  "+      <DropdownMenu>",
  "+        <DropdownMenuTrigger",
  '+          render={<Button aria-label="Open session tools" size="icon-sm" />}',
  "+        >",
  '+          <DotsThreeIcon className="size-5" />',
  "+        </DropdownMenuTrigger>",
  "+        <DropdownMenuContent>",
  "+          {mobilePortAccessControl === null ? null : (",
  '+          <DropdownMenuItem aria-label="Processes" onClick={mobilePortAccessControl.onOpen}>',
  "+            Processes",
  "+          </DropdownMenuItem>",
  "+          )}",
  "+        </DropdownMenuContent>",
  "+      </DropdownMenu>",
  "+      {mobilePortAccessControl?.surface}",
  "     </div>",
  "   );",
  " }",
].join("\n");

const DocsSessionPortAccessState = {
  buttonDisabledReason: null,
  errorMessage: null,
  isLoadingProcesses: false,
  isOpeningProcessKey: null,
  isPanelOpen: true,
  observedAt: null,
  openProcess: async () => {
    return;
  },
  processes: [
    {
      pid: 4321,
      command: "pnpm dev --host 127.0.0.1 --port 5173",
      listeners: [
        {
          bindAddress: "127.0.0.1",
          port: 5173,
        },
      ],
    },
    {
      pid: 4388,
      command: "pnpm docs:dev",
      listeners: [
        {
          bindAddress: "127.0.0.1",
          port: 3333,
        },
      ],
    },
  ],
  setPanelOpen: () => {
    return;
  },
} satisfies SessionPortAccessState;

const DocsSessionPortAccessClosedState = {
  ...DocsSessionPortAccessState,
  isPanelOpen: false,
} satisfies SessionPortAccessState;

const DocsSessionPendingDiffComments = [
  {
    id: "docs-session-comment-1",
    anchor: {
      previousLineText: "   diffControl: SessionWorkbenchHeaderButtonControl;",
      lineText: "+  mobilePortAccessControl?: SessionWorkbenchHeaderMobilePortAccessControl;",
      nextLineText: "   portAccessControl?: React.ReactNode;",
    },
    body: "Keep this separate from the desktop port control so the mobile menu can close before opening the sheet.",
    filePath: "apps/dashboard/src/features/pages/session-workbench-header-actions.tsx",
    lineNumber: 45,
    repositoryPath: "/root/mistle",
    side: "additions",
    status: {
      kind: "current",
    },
  },
] satisfies readonly PendingSessionDiffComment[];

function buildDocsPendingDiffCommentSummary(
  comments: readonly PendingSessionDiffComment[],
): NonNullable<typeof SessionComposerFixtureProps.pendingDiffCommentSummary> | null {
  if (comments.length === 0) {
    return null;
  }

  return {
    count: comments.length,
    label: buildPendingSessionDiffCommentSummaryLabel(comments.length),
    title: buildPendingSessionDiffCommentSummaryTitle(comments),
  };
}

function DocsSessionConversationBottomPanel(input?: {
  pendingDiffComments?: readonly PendingSessionDiffComment[];
}): React.JSX.Element {
  const pendingDiffComments = input?.pendingDiffComments ?? [];

  return (
    <SessionConversationBottomPanel
      chatEntries={CodexFixtureSessionEntriesWithExploringGroup}
      composerViewModel={{
        ...SessionComposerFixtureProps,
        composerText: "Review the current changes and call out anything risky before we commit.",
        pendingDiffCommentSummary: buildDocsPendingDiffCommentSummary(pendingDiffComments),
      }}
      isRespondingToServerRequest={false}
      onRespondToServerRequest={noopRespondToServerRequest}
      serverRequestPanelEntries={[]}
      showWorkingIndicator={false}
      statusMessage={null}
    />
  );
}

function DocsSessionDiffPanel(input?: {
  pendingComments?: readonly PendingSessionDiffComment[];
}): React.JSX.Element {
  return (
    <SessionDiffPanel
      patch={DocsSessionBranchPatch}
      pendingComments={input?.pendingComments ?? []}
      repositoryPath="/root/mistle"
      summaryLabel="Compared with origin/main"
      title="Current changes"
    />
  );
}

function SessionWorkbenchOverviewStory(): React.JSX.Element {
  return (
    <DocsSessionScreen name="session-workbench-overview" width={1280} height={760}>
      {renderSessionWorkbenchStoryWithChrome({
        title: "Fix duplicate checkout charges on retry",
        children: renderSessionWorkbenchStory({
          isSecondaryPanelVisible: true,
          mainContent: createStorySessionMainContent({
            serverRequestPanelEntries: [],
          }),
          primaryBottomPanel: <DocsSessionConversationBottomPanel />,
          secondaryPanel: <DocsSessionDiffPanel />,
        }),
      })}
    </DocsSessionScreen>
  );
}

function SessionCodeDiffStory(): React.JSX.Element {
  return (
    <DocsSessionScreen name="session-code-diffs" width={1280} height={760}>
      {renderSessionWorkbenchStoryWithChrome({
        title: "Review session changes",
        headerActions: <DocsSessionHeaderActions isDiffVisible />,
        children: renderSessionWorkbenchStory({
          isSecondaryPanelVisible: true,
          mainContent: createStorySessionMainContent({
            serverRequestPanelEntries: [],
          }),
          primaryBottomPanel: (
            <DocsSessionConversationBottomPanel
              pendingDiffComments={DocsSessionPendingDiffComments}
            />
          ),
          secondaryPanel: <DocsSessionDiffPanel pendingComments={DocsSessionPendingDiffComments} />,
        }),
      })}
    </DocsSessionScreen>
  );
}

function SessionPortAccessStory(): React.JSX.Element {
  return (
    <DocsSessionScreen name="session-port-access" width={1280} height={320}>
      {renderSessionWorkbenchStoryWithChrome({
        title: "Preview local dashboard server",
        headerActions: <DocsSessionHeaderActions portAccessState={DocsSessionPortAccessState} />,
        children: renderSessionWorkbenchStory({
          mainContent: <div className="h-full bg-stone-50" />,
          mainContentLayout: { scroll: "contained", width: "full" },
          primaryBottomPanel: null,
        }),
      })}
    </DocsSessionScreen>
  );
}

function DocsSessionHeaderActions(input: {
  isDiffVisible?: boolean;
  portAccessState?: SessionPortAccessState;
}): React.JSX.Element {
  const headerButtonClassName = "bg-transparent text-foreground shadow-none hover:bg-stone-100";
  const pressedButtonClassName = "bg-stone-200 text-stone-950 shadow-none hover:bg-stone-300";
  const portAccessState = input.portAccessState ?? DocsSessionPortAccessClosedState;

  return (
    <SessionWorkbenchHeaderActions
      cliControl={{
        ariaLabel: "TUI",
        className: headerButtonClassName,
        disabled: false,
        onClick: () => {
          return;
        },
        pressed: false,
        title: "Open Codex TUI",
      }}
      diffControl={{
        ariaLabel: input.isDiffVisible === true ? "Changes" : "Open changes",
        className: input.isDiffVisible === true ? pressedButtonClassName : headerButtonClassName,
        disabled: false,
        onClick: () => {
          return;
        },
        pressed: input.isDiffVisible === true,
        title: input.isDiffVisible === true ? "Changes" : "Open changes",
      }}
      portAccessControl={<SessionPortAccessPopover state={portAccessState} />}
      mobilePortAccessControl={{
        disabled: portAccessState.buttonDisabledReason !== null,
        onOpen: () => {
          portAccessState.setPanelOpen(true);
        },
        surface: <SessionPortAccessSheet state={portAccessState} />,
        title: portAccessState.buttonDisabledReason ?? "Show running processes",
      }}
      repositoryControl={{
        ariaLabel: "Primary repository",
        onValueChange: () => {
          return;
        },
        options: [
          {
            value: "/root/mistle",
            label: "mistle",
          },
          {
            value: "/root/mistle-docs",
            label: "mistle-docs",
          },
        ],
        selectedValue: "/root/mistle",
        title: "Primary repository",
      }}
      status={{
        kind: "connected",
        label: "Connected",
      }}
      terminalControl={{
        ariaLabel: "Open terminal",
        className: headerButtonClassName,
        disabled: false,
        onClick: () => {
          return;
        },
        pressed: false,
        title: "Open terminal",
      }}
    />
  );
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
          onStartProviderAppSetup={async () => {}}
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

function SandboxProfileSetupAssistantStory(): React.JSX.Element {
  return (
    <SandboxProfileEditorPageStory
      {...DefaultSandboxProfileEditorStoryArgs}
      initialBindings={[StoryBindings[0], StoryBindings[1]]}
      setupAssistantPanelState="proposed-script"
      setupAssistantState="available"
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

export const SandboxProfileSetupAssistant: Story = {
  render: SandboxProfileSetupAssistantStory,
};

export const SandboxProfileSnapshotReady: Story = {
  render: SandboxProfileSnapshotReadyStory,
};

export const NewSessionCreation: Story = {
  render: NewSessionCreationStory,
};

export const SessionWorkbenchOverview: Story = {
  render: SessionWorkbenchOverviewStory,
};

export const SessionCodeDiff: Story = {
  render: SessionCodeDiffStory,
};

export const SessionPortAccess: Story = {
  render: SessionPortAccessStory,
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
