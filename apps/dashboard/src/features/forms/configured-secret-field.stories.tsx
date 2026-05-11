import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type React from "react";
import { userEvent, within } from "storybook/test";

import { withDashboardCenteredStory } from "../../storybook/decorators.js";
import { ConfiguredSecretField, type SavingFieldState } from "./configured-secret-field.js";

function createIdleFieldState(): SavingFieldState {
  return {
    status: "idle",
    errorMessage: null,
  };
}

function ConfiguredSecretFieldStory(input: {
  confirmReplacement?: false;
  configured?: boolean;
  description?: string;
  errorMessage?: string;
  label: string;
  multiline?: boolean;
  placeholder?: string;
  replacementStaged?: boolean;
  required?: boolean;
  rows?: number;
  secretLabel: string;
  status?: SavingFieldState["status"];
  type?: React.ComponentProps<"input">["type"];
  value: string;
}): React.JSX.Element {
  const [value, setValue] = useState(input.value);
  const [fieldState, setFieldState] = useState<SavingFieldState>({
    status: input.status ?? "idle",
    errorMessage: input.errorMessage ?? null,
  });

  return (
    <div className="w-[32rem]">
      <ConfiguredSecretField
        fieldState={fieldState}
        id="storybook-configured-secret-field"
        label={input.label}
        onChange={(nextValue) => {
          setValue(nextValue);
          if (fieldState.errorMessage !== null || fieldState.status !== "idle") {
            setFieldState(createIdleFieldState());
          }
        }}
        secretLabel={input.secretLabel}
        value={value}
        {...(input.confirmReplacement === false ? { confirmReplacement: false } : {})}
        {...(input.confirmReplacement === false
          ? {}
          : {
              onCancelReplace: () => {
                setValue("");
                setFieldState(createIdleFieldState());
              },
              onCommit: () => {
                setFieldState({
                  status: "saved",
                  errorMessage: null,
                });
              },
            })}
        {...(input.configured === undefined ? {} : { configured: input.configured })}
        {...(input.description === undefined ? {} : { description: input.description })}
        {...(input.multiline === undefined ? {} : { multiline: input.multiline })}
        {...(input.placeholder === undefined ? {} : { placeholder: input.placeholder })}
        {...(input.replacementStaged === undefined
          ? {}
          : { replacementStaged: input.replacementStaged })}
        {...(input.required === undefined ? {} : { required: input.required })}
        {...(input.rows === undefined ? {} : { rows: input.rows })}
        {...(input.type === undefined ? {} : { type: input.type })}
      />
    </div>
  );
}

const meta = {
  title: "Dashboard/Forms/Configured Secret Field",
  decorators: [withDashboardCenteredStory],
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const ConfiguredSecret: Story = {
  render: function RenderStory(): React.JSX.Element {
    return (
      <ConfiguredSecretFieldStory
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

export const ReplaceOnSave: Story = {
  render: function RenderStory(): React.JSX.Element {
    return (
      <ConfiguredSecretFieldStory
        confirmReplacement={false}
        configured
        label="Webhook secret"
        replacementStaged
        required
        secretLabel="webhook secret"
        type="password"
        value="replacement-webhook-secret"
      />
    );
  },
};

export const ReplaceConfirmation: Story = {
  render: function RenderStory(): React.JSX.Element {
    return (
      <ConfiguredSecretFieldStory
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

export const SavingReplacement: Story = {
  render: function RenderStory(): React.JSX.Element {
    return (
      <ConfiguredSecretFieldStory
        confirmReplacement={false}
        configured
        label="Client secret"
        replacementStaged
        required
        secretLabel="client secret"
        status="saving"
        type="password"
        value="replacement-client-secret"
      />
    );
  },
};

export const SavedReplacement: Story = {
  render: function RenderStory(): React.JSX.Element {
    return (
      <ConfiguredSecretFieldStory
        confirmReplacement={false}
        configured
        label="Client secret"
        replacementStaged
        required
        secretLabel="client secret"
        status="saved"
        type="password"
        value="replacement-client-secret"
      />
    );
  },
};

export const MultilineConfiguredSecret: Story = {
  render: function RenderStory(): React.JSX.Element {
    return (
      <ConfiguredSecretFieldStory
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

export const MultilineReplaceOnSave: Story = {
  render: function RenderStory(): React.JSX.Element {
    return (
      <ConfiguredSecretFieldStory
        confirmReplacement={false}
        configured
        label="App private key"
        multiline
        replacementStaged
        required
        rows={8}
        secretLabel="app private key"
        value={
          "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC...\n-----END PRIVATE KEY-----"
        }
      />
    );
  },
};

export const ReplacementError: Story = {
  render: function RenderStory(): React.JSX.Element {
    return (
      <ConfiguredSecretFieldStory
        confirmReplacement={false}
        configured
        errorMessage="Webhook secret could not be updated."
        label="Webhook secret"
        replacementStaged
        required
        secretLabel="webhook secret"
        type="password"
        value="replacement-webhook-secret"
      />
    );
  },
};
