import {
  AwsBrowserDefinition,
  JiraConnectionMethodIds,
} from "@mistle/integrations-definitions/browser";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type React from "react";

import { withDashboardCenteredStory } from "../../storybook/decorators.js";
import { resolveConnectionMethodFormUiModel } from "../pages/use-integration-connection-editor-state-helpers.js";
import {
  IntegrationConnectionEditorPage,
  IntegrationConnectionMethodIds,
  type IntegrationConnectionMethod,
  type IntegrationConnectionMethodId,
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

const JiraCreateEditorState: Extract<IntegrationConnectionEditorState, { mode: "create" }> = {
  methods: [
    {
      id: JiraConnectionMethodIds.PERSONAL_API_TOKEN,
      label: "Personal API token",
      kind: "form",
      secretFields: [
        {
          name: "apiKey",
          label: "Personal API token",
          placeholder: "Enter personal API token",
          inputType: "password",
        },
      ],
    },
  ],
  mode: "create",
  targetConfig: {},
  targetDisplayName: "Jira",
  targetFamilyId: "jira",
  targetKey: "jira-default",
  targetVariantId: "jira-default",
};

function resolveAwsAssumeRoleMethod(): IntegrationConnectionMethod {
  const method = AwsBrowserDefinition.connectionMethods.find(
    (candidate) => candidate.id === IntegrationConnectionMethodIds.AWS_ASSUME_ROLE,
  );
  if (method === undefined) {
    throw new Error("Missing AWS AssumeRole connection method for Storybook.");
  }

  if (method.kind !== "form") {
    throw new Error("Expected AWS AssumeRole connection method to use a form.");
  }

  return {
    id: method.id,
    label: method.label,
    kind: method.kind,
    secretFields: method.secretFields.map((field) => ({
      name: field.name,
      label: field.label,
      inputType: field.inputType,
      ...(field.placeholder === undefined ? {} : { placeholder: field.placeholder }),
      ...(field.description === undefined ? {} : { description: field.description }),
      ...(field.optional === undefined ? {} : { optional: field.optional }),
      ...(field.slotKey === undefined ? {} : { slotKey: field.slotKey }),
    })),
  };
}

const AwsAssumeRoleMethod = resolveAwsAssumeRoleMethod();

const AwsCreateEditorState: Extract<IntegrationConnectionEditorState, { mode: "create" }> = {
  methods: [AwsAssumeRoleMethod],
  mode: "create",
  targetConfig: {},
  targetDisplayName: AwsBrowserDefinition.displayName,
  targetFamilyId: AwsBrowserDefinition.familyId,
  targetKey: AwsBrowserDefinition.variantId,
  targetVariantId: AwsBrowserDefinition.variantId,
};

const ChatGptDeviceAuthorizationMethod: Extract<
  IntegrationConnectionMethod,
  { kind: "device-authorization" }
> = {
  id: "chatgpt-device-code",
  label: "ChatGPT subscription",
  kind: "device-authorization",
  ui: {
    create: {
      submitLabel: "Connect",
    },
    pending: {
      title: "Approve via ChatGPT",
      description: "Open the link below and enter the code to approve access.",
    },
    reauthorize: {
      actionLabel: "Re-authorize",
      pendingLabel: "Starting...",
    },
  },
};

const ChatGptDeviceAuthorizationEditorState: Extract<
  IntegrationConnectionEditorState,
  { mode: "update" }
> = {
  connectionConfig: {
    auth_mode: "chatgpt",
    connection_method: "chatgpt-device-code",
  },
  connectionId: "icn_openai_chatgpt_story",
  currentConnectionConfig: {
    auth_mode: "chatgpt",
    connection_method: "chatgpt-device-code",
  },
  currentMethod: ChatGptDeviceAuthorizationMethod,
  initialConnectionDisplayName: "ChatGPT Subscription",
  mode: "update",
  reauthorization: {
    kind: "device-authorization",
  },
  targetConfig: {},
  targetDisplayName: "OpenAI",
  targetFamilyId: "openai",
  targetKey: "openai-default",
  targetVariantId: "openai-default",
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

function CreateFormConnectionEditorStory(input: {
  connectionDisplayNamePlaceholder: string;
  editor: Extract<IntegrationConnectionEditorState, { mode: "create" }>;
  initialConfigValue: Record<string, unknown>;
  methodId: IntegrationConnectionMethodId;
}): React.JSX.Element {
  const [configValue, setConfigValue] = useState<Record<string, unknown>>(input.initialConfigValue);
  const [connectionDisplayName, setConnectionDisplayName] = useState("");
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [changedSecretNames, setChangedSecretNames] = useState<readonly string[]>([]);
  const configForm = resolveConnectionMethodFormUiModel({
    editor: input.editor,
    methodId: input.methodId,
    currentValue: configValue,
  });

  return (
    <div className="mx-auto w-full max-w-2xl">
      <IntegrationConnectionEditorPage
        changedSecretNames={changedSecretNames}
        closeDisabled={false}
        configForm={configForm}
        configValue={configValue}
        connectError={null}
        connectionDisplayNamePlaceholder={input.connectionDisplayNamePlaceholder}
        connectionDisplayNameValue={connectionDisplayName}
        editor={input.editor}
        hasChanges={true}
        isConnectionDisplayNameChanged={connectionDisplayName.trim().length > 0}
        methodId={input.methodId}
        onClose={() => {}}
        onConfigChange={setConfigValue}
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

function JiraPersonalApiTokenEditorStory(): React.JSX.Element {
  return (
    <CreateFormConnectionEditorStory
      connectionDisplayNamePlaceholder="Jira connection"
      editor={JiraCreateEditorState}
      initialConfigValue={{
        connection_method: JiraConnectionMethodIds.PERSONAL_API_TOKEN,
      }}
      methodId={JiraConnectionMethodIds.PERSONAL_API_TOKEN}
    />
  );
}

function AwsAssumeRoleEditorStory(): React.JSX.Element {
  return (
    <CreateFormConnectionEditorStory
      connectionDisplayNamePlaceholder="AWS production"
      editor={AwsCreateEditorState}
      initialConfigValue={{
        connection_method: AwsAssumeRoleMethod.id,
      }}
      methodId={AwsAssumeRoleMethod.id}
    />
  );
}

function ChatGptDeviceReauthorizationPendingStory(): React.JSX.Element {
  return (
    <div className="mx-auto w-full max-w-2xl">
      <IntegrationConnectionEditorPage
        changedSecretNames={[]}
        closeDisabled={false}
        configForm={{
          mode: "none",
        }}
        configValue={{}}
        connectError={null}
        connectionDisplayNamePlaceholder="ChatGPT Subscription"
        connectionDisplayNameValue=""
        deviceAuthorizationPending={{
          targetKey: "openai-default",
          attemptId: "ida_story_chatgpt",
          verificationUrl: "https://auth.openai.com/codex/device",
          userCode: "ABCD-EFGH",
          expiresAt: "2099-12-31T23:59:00.000Z",
          method: ChatGptDeviceAuthorizationMethod,
        }}
        editor={ChatGptDeviceAuthorizationEditorState}
        hasChanges={false}
        isConnectionDisplayNameChanged={false}
        methodId="chatgpt-device-code"
        onClose={() => {}}
        onConfigChange={() => {}}
        onConnectionDisplayNameChange={() => {}}
        onMethodChange={() => {}}
        onSecretChange={() => {}}
        onSubmit={() => {}}
        pending={false}
        secrets={{}}
      />
    </div>
  );
}

const meta = {
  title: "Dashboard/Integrations/Connection Editor",
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

export const JiraPersonalApiToken: Story = {
  render: function RenderStory() {
    return <JiraPersonalApiTokenEditorStory />;
  },
};

export const AwsAssumeRole: Story = {
  name: "AWS Assume Role",
  render: function RenderStory() {
    return <AwsAssumeRoleEditorStory />;
  },
};

export const ChatGptDeviceReauthorizationPending: Story = {
  render: function RenderStory() {
    return <ChatGptDeviceReauthorizationPendingStory />;
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
