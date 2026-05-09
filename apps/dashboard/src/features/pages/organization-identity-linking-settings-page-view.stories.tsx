import { systemSleeper } from "@mistle/time";
import { toast } from "@mistle/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type React from "react";
import { useState } from "react";
import { userEvent, within } from "storybook/test";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import {
  OrganizationIdentityLinkingSettingsPageView,
  type OrganizationIdentityLinkingProviderRow,
} from "./organization-identity-linking-settings-page-view.js";

const BaseProviders = [
  {
    providerFamily: "github",
    displayName: "GitHub",
    logoKey: "github",
    connectionOptions: [
      {
        id: "conn_github_primary",
        label: "GitHub Engineering",
      },
      {
        id: "conn_github_platform",
        label: "GitHub Platform",
      },
    ],
    selectedConnectionId: "conn_github_primary",
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
    enabled: false,
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
  {
    providerFamily: "linear",
    displayName: "Linear",
    logoKey: "linear",
    connectionOptions: [],
    selectedConnectionId: null,
    connectionPending: false,
    enablePending: false,
    enabled: false,
    linkedUsersCount: 0,
    memberLinksErrorMessage: null,
    memberLinks: [],
  },
] as const satisfies readonly OrganizationIdentityLinkingProviderRow[];

function wait(ms: number): Promise<void> {
  return systemSleeper.sleep(ms);
}

function StatefulPrototype(
  args: Omit<
    React.ComponentProps<typeof OrganizationIdentityLinkingSettingsPageView>,
    "onEnabledChange" | "onProviderConnectionChange"
  >,
): React.JSX.Element {
  const [providers, setProviders] = useState(args.providers);

  return (
    <OrganizationIdentityLinkingSettingsPageView
      {...args}
      onEnabledChange={async ({ providerFamily, enabled }) => {
        setProviders((currentProviders) =>
          currentProviders.map((provider) =>
            provider.providerFamily !== providerFamily
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
            provider.providerFamily !== providerFamily
              ? provider
              : {
                  ...provider,
                  enabled,
                  enablePending: false,
                },
          ),
        );
      }}
      onProviderConnectionChange={async ({ providerFamily, integrationConnectionId }) => {
        setProviders((currentProviders) =>
          currentProviders.map((provider) =>
            provider.providerFamily !== providerFamily
              ? provider
              : {
                  ...provider,
                  selectedConnectionId: integrationConnectionId,
                  connectionPending: true,
                },
          ),
        );

        await wait(500);

        setProviders((currentProviders) =>
          currentProviders.map((provider) =>
            provider.providerFamily !== providerFamily
              ? provider
              : {
                  ...provider,
                  connectionPending: false,
                },
          ),
        );
      }}
      providers={providers}
    />
  );
}

/** Review this Storybook surface as the proposed autosaving list-based replacement for the current provider cards. */
const meta = {
  title: "Dashboard/Settings/OrganizationIdentityLinking/PageView",
  component: OrganizationIdentityLinkingSettingsPageView,
  decorators: [withDashboardPageStory],
  render: StatefulPrototype,
  args: {
    loadErrorMessage: null,
    onEnabledChange: async () => {},
    onProviderConnectionChange: async () => {},
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

export const UnconfiguredProviderWithDisplayedConnection: Story = {
  args: {
    providers: [
      {
        providerFamily: "github",
        displayName: "GitHub",
        logoKey: "github",
        connectionOptions: [
          {
            id: "conn_github_primary",
            label: "GitHub Engineering",
          },
          {
            id: "conn_github_platform",
            label: "GitHub Platform",
          },
        ],
        selectedConnectionId: "conn_github_primary",
        connectionPending: false,
        enablePending: false,
        enabled: false,
        linkedUsersCount: 0,
        memberLinksErrorMessage: null,
        memberLinks: [],
      },
    ],
  },
};

export const LinkedUsersDialogError: Story = {
  args: {
    providers: [
      {
        ...BaseProviders[0],
        memberLinksErrorMessage: "Could not load linked-member visibility.",
        memberLinks: [],
        linkedUsersCount: 0,
      },
    ],
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole("button", { name: "View GitHub linked users" }));
  },
};

export const LinkedUsersUnknown: Story = {
  args: {
    providers: [
      {
        ...BaseProviders[0],
        linkedUsersCount: null,
        memberLinks: [],
      },
    ],
  },
};

export const ConnectionSaveErrorToast: Story = {
  render: (args) => {
    function FailurePrototype(): React.JSX.Element {
      const [providers, setProviders] = useState(args.providers);

      return (
        <OrganizationIdentityLinkingSettingsPageView
          {...args}
          onEnabledChange={async ({ providerFamily, enabled }) => {
            setProviders((currentProviders) =>
              currentProviders.map((provider) =>
                provider.providerFamily !== providerFamily
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
                provider.providerFamily !== providerFamily
                  ? provider
                  : {
                      ...provider,
                      enablePending: false,
                      enabled,
                    },
              ),
            );
          }}
          onProviderConnectionChange={async ({ providerFamily, integrationConnectionId }) => {
            const previousSelection =
              providers.find((provider) => provider.providerFamily === providerFamily)
                ?.selectedConnectionId ?? null;

            setProviders((currentProviders) =>
              currentProviders.map((provider) =>
                provider.providerFamily !== providerFamily
                  ? provider
                  : {
                      ...provider,
                      selectedConnectionId: integrationConnectionId,
                      connectionPending: true,
                    },
              ),
            );

            await wait(500);

            setProviders((currentProviders) =>
              currentProviders.map((provider) =>
                provider.providerFamily !== providerFamily
                  ? provider
                  : {
                      ...provider,
                      selectedConnectionId: previousSelection,
                      connectionPending: false,
                    },
              ),
            );

            toast.error("Could not save identity-linking provider configuration.");
          }}
          providers={providers}
        />
      );
    }

    return <FailurePrototype />;
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole("combobox", { name: "GitHub connection" }));
    await userEvent.click(canvas.getByRole("option", { name: "GitHub Platform" }));
  },
};
