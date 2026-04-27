import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type React from "react";

import { withDashboardCenteredStory } from "../../storybook/decorators.js";
import {
  IntegrationConnectionEditorPage,
  IntegrationConnectionMethodIds,
  type IntegrationConnectionEditorState,
} from "./integration-connection-editor.js";

const EditorState: Extract<IntegrationConnectionEditorState, { mode: "update" }> = {
  connectionConfig: {
    connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
    app_id: "123456",
    app_slug: "mistle-github",
    client_id: "Iv1.storybookclient",
  },
  connectionId: "icn_storybook_github",
  configuredSecretNames: ["appPrivateKeyPem", "clientSecret", "webhookSecret"],
  currentConnectionConfig: {
    connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
    app_id: "123456",
    app_slug: "mistle-github",
    client_id: "Iv1.storybookclient",
  },
  currentMethod: {
    id: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
    label: "GitHub App installation",
    kind: "form",
    secretFields: [
      {
        name: "appPrivateKeyPem",
        label: "App private key PEM",
        description: "Private key used to sign GitHub App installation requests.",
        placeholder: "-----BEGIN PRIVATE KEY-----",
        inputType: "textarea",
      },
      {
        name: "clientSecret",
        label: "Client secret",
        inputType: "password",
      },
      {
        name: "webhookSecret",
        label: "Webhook secret",
        inputType: "password",
      },
    ],
  },
  initialConnectionDisplayName: "GitHub Production",
  mode: "update",
  targetConfig: {
    api_base_url: "https://api.github.com",
    web_base_url: "https://github.com",
  },
  targetDisplayName: "GitHub",
  targetFamilyId: "github",
  targetKey: "github-cloud",
  targetVariantId: "github-cloud",
};

function IntegrationConnectionEditorStory(input: {
  changedSecretNames?: readonly string[];
  initialSecrets?: Record<string, string>;
}): React.JSX.Element {
  const [connectionDisplayName, setConnectionDisplayName] = useState("");
  const [secrets, setSecrets] = useState<Record<string, string>>(input.initialSecrets ?? {});
  const [changedSecretNames, setChangedSecretNames] = useState<readonly string[]>(
    input.changedSecretNames ?? [],
  );

  return (
    <div className="mx-auto w-full max-w-2xl">
      <IntegrationConnectionEditorPage
        changedSecretNames={changedSecretNames}
        closeDisabled={false}
        configForm={{
          mode: "none",
        }}
        configValue={{}}
        connectError={null}
        connectionDisplayNamePlaceholder="GitHub Production"
        connectionDisplayNameValue={connectionDisplayName}
        editor={EditorState}
        hasChanges={
          connectionDisplayName.trim().length > 0 ||
          changedSecretNames.some((name) => (secrets[name] ?? "").trim().length > 0)
        }
        isConnectionDisplayNameChanged={connectionDisplayName.trim().length > 0}
        methodId={IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION}
        onClose={() => {}}
        onConfigChange={() => {}}
        onConnectionDisplayNameChange={setConnectionDisplayName}
        onMethodChange={() => {}}
        onSecretChange={(name, value) => {
          setSecrets((currentSecrets) => ({
            ...currentSecrets,
            [name]: value,
          }));
          setChangedSecretNames((currentNames) =>
            value.trim().length === 0
              ? currentNames.filter((currentName) => currentName !== name)
              : [...currentNames.filter((currentName) => currentName !== name), name],
          );
        }}
        onSubmit={() => {}}
        pending={false}
        secrets={secrets}
      />
    </div>
  );
}

const meta = {
  title: "Dashboard/Integrations/Connection/Editor",
  component: IntegrationConnectionEditorStory,
  decorators: [withDashboardCenteredStory],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof IntegrationConnectionEditorStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const ConfiguredSecrets: Story = {
  render: function RenderStory() {
    return <IntegrationConnectionEditorStory />;
  },
};

export const PendingSecretReplacement: Story = {
  render: function RenderStory() {
    return (
      <IntegrationConnectionEditorStory
        changedSecretNames={["webhookSecret"]}
        initialSecrets={{
          webhookSecret: "replacement-webhook-secret",
        }}
      />
    );
  },
};

export const PendingPrivateKeyReplacement: Story = {
  render: function RenderStory() {
    return (
      <IntegrationConnectionEditorStory
        changedSecretNames={["appPrivateKeyPem"]}
        initialSecrets={{
          appPrivateKeyPem:
            "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC...\n-----END PRIVATE KEY-----",
        }}
      />
    );
  },
};
