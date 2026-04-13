import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";

import { withDashboardCenteredStory } from "../../storybook/decorators.js";
import { FormPageFrame } from "../shared/page-frame.js";
import {
  IntegrationConnectionEditorPage,
  IntegrationConnectionMethodIds,
  type IntegrationConnectionEditorState,
} from "./integration-connection-editor.js";

const githubAppCreateEditor: IntegrationConnectionEditorState = {
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
      kind: "form",
      secretFields: [
        {
          name: "appPrivateKeyPem",
          label: "App private key PEM",
          placeholder: "-----BEGIN PRIVATE KEY-----",
          inputType: "password",
        },
        {
          name: "webhookSecret",
          label: "Webhook secret",
          placeholder: "Enter webhook secret",
          inputType: "password",
        },
      ],
    },
  ],
  mode: "create",
  targetConfig: {},
  targetDisplayName: "GitHub",
  targetFamilyId: "github",
  targetKey: "github-cloud",
  targetVariantId: "github-cloud",
};

function IntegrationConnectionEditorPageStory(
  props: ComponentProps<typeof IntegrationConnectionEditorPage>,
): React.JSX.Element {
  return (
    <FormPageFrame description="github-cloud" title="Add GitHub Connection">
      <IntegrationConnectionEditorPage {...props} />
    </FormPageFrame>
  );
}

const meta = {
  title: "Dashboard/Integrations/Connection/EditorPage",
  component: IntegrationConnectionEditorPageStory,
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
    editor: githubAppCreateEditor,
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
} satisfies Meta<typeof IntegrationConnectionEditorPageStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const GitHubAppCreate: Story = {};

export const GitHubAppCreatePending: Story = {
  args: {
    pending: true,
  },
};
