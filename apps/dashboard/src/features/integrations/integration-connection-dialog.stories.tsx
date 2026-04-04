import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardCenteredStory } from "../../storybook/decorators.js";
import {
  IntegrationConnectionDialog,
  IntegrationConnectionMethodIds,
  type IntegrationConnectionDialogState,
} from "./integration-connection-dialog.js";

const redirectCreateDialog: IntegrationConnectionDialogState = {
  methods: [
    {
      id: IntegrationConnectionMethodIds.API_KEY,
      label: "API key",
      kind: "form",
      secretFields: [
        {
          name: "apiKey",
          label: "API key",
          placeholder: "Enter API key",
          inputType: "password",
        },
      ],
    },
    {
      id: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
      label: "GitHub App installation",
      kind: "redirect",
      ui: {
        create: {
          submitLabel: "Install GitHub App",
          helperText: "Continue to GitHub to install the app and finish connecting this account.",
        },
      },
    },
  ],
  mode: "create",
  targetConfig: {},
  targetDisplayName: "GitHub",
  targetFamilyId: "github",
  targetKey: "github-cloud",
  targetVariantId: "github-cloud",
};

const meta = {
  title: "Dashboard/Integrations/Connection/Dialog",
  component: IntegrationConnectionDialog,
  decorators: [withDashboardCenteredStory],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    configForm: {
      mode: "none",
    },
    configValue: {},
    connectionDisplayNamePlaceholder: "GitHub connection",
    connectionDisplayNameValue: "",
    connectError: null,
    dialog: redirectCreateDialog,
    hasChanges: true,
    isConnectionDisplayNameChanged: false,
    isSecretChanged: false,
    methodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
    onClose: () => {},
    onConfigChange: () => {},
    onConnectionDisplayNameChange: () => {},
    onMethodChange: () => {},
    onSecretChange: () => {},
    onSubmit: () => {},
    pending: false,
    secrets: {},
  },
} satisfies Meta<typeof IntegrationConnectionDialog>;

export default meta;

type Story = StoryObj<typeof meta>;

export const RedirectCreate: Story = {};

export const RedirectCreatePending: Story = {
  args: {
    pending: true,
  },
};
