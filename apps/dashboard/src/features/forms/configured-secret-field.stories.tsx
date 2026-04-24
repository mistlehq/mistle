import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type React from "react";
import { userEvent, within } from "storybook/test";

import { withDashboardCenteredStory } from "../../storybook/decorators.js";
import {
  ConfiguredSecretField,
  SavingTextField,
  type SavingFieldState,
} from "./configured-secret-field.js";

function createIdleFieldState(): SavingFieldState {
  return {
    status: "idle",
    errorMessage: null,
  };
}

function SavingTextFieldStory(input: {
  description?: string;
  errorMessage?: string;
  label: string;
  multiline?: boolean;
  placeholder?: string;
  required?: boolean;
  rows?: number;
  status?: SavingFieldState["status"];
  type?: React.ComponentProps<"input">["type"];
  value: string;
}): React.JSX.Element {
  const [value, setValue] = useState(input.value);

  return (
    <div className="w-[32rem]">
      <SavingTextField
        fieldState={{
          status: input.status ?? "idle",
          errorMessage: input.errorMessage ?? null,
        }}
        id="storybook-saving-text-field"
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

function ConfiguredSecretFieldStory(input: {
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
  const [fieldState, setFieldState] = useState<SavingFieldState>(createIdleFieldState);

  return (
    <div className="w-[32rem]">
      <ConfiguredSecretField
        fieldState={fieldState}
        id="storybook-configured-secret-field"
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
  title: "Dashboard/Forms/Configured Secret Field",
  decorators: [withDashboardCenteredStory],
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const BasicField: Story = {
  render: function RenderStory(): React.JSX.Element {
    return <SavingTextFieldStory label="App ID" required value="123456" />;
  },
};

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

export const ErrorState: Story = {
  render: function RenderStory(): React.JSX.Element {
    return (
      <SavingTextFieldStory
        errorMessage="Client ID is required."
        label="Client ID"
        required
        value=""
      />
    );
  },
};
