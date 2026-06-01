import { systemSleeper } from "@mistle/time";
import { toast, Toaster } from "@mistle/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type React from "react";
import { useState } from "react";
import { userEvent, within } from "storybook/test";

import {
  OrganizationIdentityLinkingSettingsPageView,
  type OrganizationIdentityLinkingProviderRow,
} from "./organization-identity-linking-settings-page-view.js";
import {
  IdentityLinkingStoryMemberLinkStatusCounts,
  createIdentityLinkingMemberLinks,
} from "./organization-identity-linking-settings-page-view.story-fixtures.js";

const BaseProviders = [
  {
    rowKey: "github:conn_github_engineering",
    canOpenMemberLinkStatus: true,
    displayName: "GitHub",
    logoKey: "github",
    connectionLabel: "GitHub Engineering",
    enablePending: false,
    enabled: true,
    unavailableMessage: null,
    memberLinkStatusCounts: IdentityLinkingStoryMemberLinkStatusCounts.GITHUB_ENGINEERING,
    memberLinksErrorMessage: null,
    memberLinks: createIdentityLinkingMemberLinks({
      count: IdentityLinkingStoryMemberLinkStatusCounts.GITHUB_ENGINEERING,
      emailDomain: "example.com",
      idPrefix: "github_engineering",
    }),
  },
  {
    rowKey: "github:conn_github_platform",
    canOpenMemberLinkStatus: false,
    displayName: "GitHub",
    logoKey: "github",
    connectionLabel: "GitHub Platform",
    enablePending: false,
    enabled: false,
    unavailableMessage: null,
    memberLinkStatusCounts: null,
    memberLinksErrorMessage: null,
    memberLinks: [],
  },
  {
    rowKey: "slack:conn_slack_workspace",
    canOpenMemberLinkStatus: true,
    displayName: "Slack",
    logoKey: "slack",
    connectionLabel: "Slack Workspace",
    enablePending: false,
    enabled: false,
    unavailableMessage: null,
    memberLinkStatusCounts: IdentityLinkingStoryMemberLinkStatusCounts.SLACK_WORKSPACE,
    memberLinksErrorMessage: null,
    memberLinks: createIdentityLinkingMemberLinks({
      count: IdentityLinkingStoryMemberLinkStatusCounts.SLACK_WORKSPACE,
      emailDomain: "example.com",
      idPrefix: "slack_workspace",
    }),
  },
] as const satisfies readonly OrganizationIdentityLinkingProviderRow[];

function wait(ms: number): Promise<void> {
  return systemSleeper.sleep(ms);
}

function StatefulPrototype(
  args: Omit<
    React.ComponentProps<typeof OrganizationIdentityLinkingSettingsPageView>,
    "onEnabledChange"
  >,
): React.JSX.Element {
  const [providers, setProviders] = useState(args.providers);

  return (
    <OrganizationIdentityLinkingSettingsPageView
      {...args}
      onEnabledChange={async ({ rowKey, enabled }) => {
        setProviders((currentProviders) =>
          currentProviders.map((provider) =>
            provider.rowKey !== rowKey
              ? provider
              : {
                  ...provider,
                  enablePending: true,
                },
          ),
        );

        await wait(500);

        setProviders((currentProviders) =>
          currentProviders.map((provider) =>
            provider.rowKey !== rowKey
              ? provider
              : {
                  ...provider,
                  canOpenMemberLinkStatus: true,
                  memberLinkStatusCounts: provider.memberLinkStatusCounts ?? {
                    linked: 0,
                    total: 0,
                  },
                  enabled,
                  enablePending: false,
                },
          ),
        );
      }}
      providers={providers}
    />
  );
}

function withIdentityLinkingSettingsStory(Story: () => React.JSX.Element): React.JSX.Element {
  return (
    <div className="flex min-h-screen w-[100vw] min-w-[69rem] flex-col p-4">
      <div className="mx-auto w-full max-w-5xl">
        <Story />
      </div>
      <Toaster position="top-right" />
    </div>
  );
}

const meta = {
  title: "Dashboard/Settings/OrganizationIdentityLinking/PageView",
  component: OrganizationIdentityLinkingSettingsPageView,
  decorators: [withIdentityLinkingSettingsStory],
  render: StatefulPrototype,
  args: {
    loadErrorMessage: null,
    gitCommitSigningImpactConfirmation: null,
    onCancelGitCommitSigningImpactConfirmation: () => {},
    onEnabledChange: async () => {},
    onConfirmGitCommitSigningImpactConfirmation: async () => {},
    providers: BaseProviders,
  },
} satisfies Meta<typeof OrganizationIdentityLinkingSettingsPageView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {},
};

export const LoadError: Story = {
  args: {
    loadErrorMessage: "Could not load identity-linking providers.",
    providers: [],
  },
};

export const NoProvidersAvailable: Story = {
  args: {
    providers: [],
  },
};

export const UnconfiguredConnection: Story = {
  args: {
    providers: [
      {
        ...BaseProviders[1],
      },
    ],
  },
};

export const UnavailableConfiguredConnection: Story = {
  args: {
    providers: [
      {
        ...BaseProviders[0],
        unavailableMessage:
          "This connection is no longer active. Disable identity linking or reconnect it.",
      },
      BaseProviders[1],
    ],
  },
};

export const GitCommitSigningEnableConfirmation: Story = {
  args: {
    gitCommitSigningImpactConfirmation: {
      action: "enable",
      connectionLabel: "GitHub Platform",
      providerDisplayName: "GitHub",
      updatedProfileCount: 4,
      invariantViolationCount: 0,
      pending: false,
    },
    providers: [
      BaseProviders[0],
      {
        ...BaseProviders[1],
        enabled: false,
      },
    ],
  },
};

export const GitCommitSigningDisableConfirmation: Story = {
  args: {
    gitCommitSigningImpactConfirmation: {
      action: "disable",
      connectionLabel: "GitHub Engineering",
      providerDisplayName: "GitHub",
      updatedProfileCount: 4,
      invariantViolationCount: 0,
      pending: false,
    },
    providers: [
      {
        ...BaseProviders[0],
        enabled: true,
      },
      BaseProviders[1],
    ],
  },
};

export const GitCommitSigningInvariantWarningConfirmation: Story = {
  args: {
    gitCommitSigningImpactConfirmation: {
      action: "enable",
      connectionLabel: "GitHub Platform",
      providerDisplayName: "GitHub",
      updatedProfileCount: 0,
      invariantViolationCount: 2,
      pending: false,
    },
    providers: [
      BaseProviders[0],
      {
        ...BaseProviders[1],
        enabled: false,
      },
    ],
  },
};

export const GitCommitSigningNoImpact: Story = {
  args: {
    providers: [
      BaseProviders[0],
      {
        ...BaseProviders[1],
        enabled: false,
      },
    ],
  },
};

export const MultipleGitHubConnections: Story = {
  args: {
    providers: BaseProviders,
  },
};

export const MultipleGitHubConnectionsEnableConfirmation: Story = {
  args: {
    gitCommitSigningImpactConfirmation: {
      action: "enable",
      connectionLabel: "GitHub Platform",
      providerDisplayName: "GitHub",
      updatedProfileCount: 5,
      invariantViolationCount: 0,
      pending: false,
    },
    providers: BaseProviders,
  },
};

export const MemberLinkStatusSheetError: Story = {
  args: {
    providers: [
      {
        ...BaseProviders[0],
        memberLinksErrorMessage: "Could not load link status.",
        memberLinks: [],
        memberLinkStatusCounts: { linked: 0, total: 0 },
      },
    ],
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await userEvent.click(
      canvas.getByRole("button", {
        name: "View GitHub link status for GitHub Engineering",
      }),
    );
  },
};

export const MemberLinkStatusUnknown: Story = {
  args: {
    providers: [
      {
        ...BaseProviders[0],
        memberLinkStatusCounts: null,
        memberLinks: [],
      },
    ],
  },
};

export const StatusSaveErrorToast: Story = {
  render: (args) => {
    function FailurePrototype(): React.JSX.Element {
      const [providers, setProviders] = useState(args.providers);

      return (
        <OrganizationIdentityLinkingSettingsPageView
          {...args}
          onEnabledChange={async ({ rowKey }) => {
            setProviders((currentProviders) =>
              currentProviders.map((provider) =>
                provider.rowKey !== rowKey
                  ? provider
                  : {
                      ...provider,
                      enablePending: true,
                    },
              ),
            );

            await wait(500);

            setProviders((currentProviders) =>
              currentProviders.map((provider) =>
                provider.rowKey !== rowKey
                  ? provider
                  : {
                      ...provider,
                      enablePending: false,
                    },
              ),
            );

            toast.error("Could not update identity-linking provider status.");
          }}
          providers={providers}
        />
      );
    }

    return <FailurePrototype />;
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await userEvent.click(
      canvas.getByRole("switch", {
        name: "Enable GitHub identity linking for GitHub Engineering",
      }),
    );
  },
};
