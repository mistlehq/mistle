import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type React from "react";
import { userEvent, within } from "storybook/test";

import { withDashboardCenteredStory } from "../../storybook/decorators.js";
import {
  GitHubManualSetupField,
  GitHubManualSetupSecretField,
  type GitHubManualSetupFieldState,
} from "./integration-connection-github-manual-setup-fields.js";

function createIdleFieldState(): GitHubManualSetupFieldState {
  return {
    status: "idle",
    errorMessage: null,
  };
}

function GitHubManualSetupFieldStory(input: {
  description?: string;
  errorMessage?: string;
  label: string;
  multiline?: boolean;
  placeholder?: string;
  required?: boolean;
  rows?: number;
  status?: GitHubManualSetupFieldState["status"];
  type?: React.ComponentProps<"input">["type"];
  value: string;
}): React.JSX.Element {
  const [value, setValue] = useState(input.value);

  return (
    <div className="w-[32rem]">
      <GitHubManualSetupField
        fieldState={{
          status: input.status ?? "idle",
          errorMessage: input.errorMessage ?? null,
        }}
        id="storybook-github-manual-setup-field"
        label={input.label}
        onBlur={() => {}}
        onChange={setValue}
        value={value}
        {...(input.description === undefined ? {} : { description: input.description })}
        {...(input.multiline === undefined ? {} : { multiline: input.multiline })}
        {...(input.placeholder === undefined ? {} : { placeholder: input.placeholder })}
        {...(input.required === undefined ? {} : { required: input.required })}
        {...(input.rows === undefined ? {} : { rows: input.rows })}
        {...(input.type === undefined ? {} : { type: input.type })}
      />
    </div>
  );
}

function GitHubManualSetupSecretFieldStory(input: {
  configured?: boolean;
  description?: string;
  label: string;
  multiline?: boolean;
  placeholder?: string;
  required?: boolean;
  rows?: number;
  secretLabel: string;
  type?: React.ComponentProps<"input">["type"];
  value: string;
}): React.JSX.Element {
  const [value, setValue] = useState(input.value);
  const [fieldState, setFieldState] = useState<GitHubManualSetupFieldState>(createIdleFieldState);

  return (
    <div className="w-[32rem]">
      <GitHubManualSetupSecretField
        fieldState={fieldState}
        id="storybook-github-manual-secret-field"
        label={input.label}
        onCancelReplace={() => {
          setValue("");
          setFieldState(createIdleFieldState());
        }}
        onChange={(nextValue) => {
          setValue(nextValue);
          if (fieldState.errorMessage !== null || fieldState.status !== "idle") {
            setFieldState(createIdleFieldState());
          }
        }}
        onCommit={() => {
          setFieldState({
            status: "saved",
            errorMessage: null,
          });
        }}
        secretLabel={input.secretLabel}
        value={value}
        {...(input.configured === undefined ? {} : { configured: input.configured })}
        {...(input.description === undefined ? {} : { description: input.description })}
        {...(input.multiline === undefined ? {} : { multiline: input.multiline })}
        {...(input.placeholder === undefined ? {} : { placeholder: input.placeholder })}
        {...(input.required === undefined ? {} : { required: input.required })}
        {...(input.rows === undefined ? {} : { rows: input.rows })}
        {...(input.type === undefined ? {} : { type: input.type })}
      />
    </div>
  );
}

const meta = {
  title: "Dashboard/Integrations/GitHub Setup Fields",
  decorators: [withDashboardCenteredStory],
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const BasicField: Story = {
  render: function RenderStory(): React.JSX.Element {
    return <GitHubManualSetupFieldStory label="App ID" required value="123456" />;
  },
};

export const ConfiguredSecretField: Story = {
  render: function RenderStory(): React.JSX.Element {
    return (
      <GitHubManualSetupSecretFieldStory
        configured
        label="Client secret"
        required
        secretLabel="client secret"
        type="password"
        value=""
      />
    );
  },
};

export const SecretFieldReplaceConfirmation: Story = {
  render: function RenderStory(): React.JSX.Element {
    return (
      <GitHubManualSetupSecretFieldStory
        configured
        label="Webhook secret"
        required
        secretLabel="webhook secret"
        type="password"
        value=""
      />
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText("Webhook secret");

    await userEvent.click(input);
    await userEvent.type(input, "replacement-secret");
    await userEvent.tab();
  },
};

export const MultilineConfiguredSecretField: Story = {
  render: function RenderStory(): React.JSX.Element {
    return (
      <GitHubManualSetupSecretFieldStory
        configured
        label="App private key"
        multiline
        placeholder="-----BEGIN PRIVATE KEY-----"
        required
        rows={8}
        secretLabel="app private key"
        value=""
      />
    );
  },
};

export const FieldErrorState: Story = {
  render: function RenderStory(): React.JSX.Element {
    return (
      <GitHubManualSetupFieldStory
        errorMessage="Client ID is required."
        label="Client ID"
        required
        value=""
      />
    );
  },
};
