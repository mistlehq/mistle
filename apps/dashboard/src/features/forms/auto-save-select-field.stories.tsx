import { systemSleeper } from "@mistle/time";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type React from "react";
import { useState } from "react";

import { AutoSaveSelectField, type AutoSaveSelectFieldProps } from "./auto-save-select-field.js";

const DefaultOptions = [
  { value: "mistle-user@example.com", label: "mistle-user@example.com (Primary)" },
  { value: "engineering@example.com", label: "engineering@example.com" },
  { value: "oss@example.com", label: "oss@example.com" },
] as const;

const meta = {
  title: "Dashboard/Forms/AutoSaveSelectField",
  component: AutoSaveSelectField,
  args: {
    id: "storybook-auto-save-select",
    label: "Commit email",
    onSave: async () => {},
    options: DefaultOptions,
    value: "mistle-user@example.com",
  },
} satisfies Meta<AutoSaveSelectFieldProps>;

export default meta;

type Story = StoryObj<typeof meta>;

function InteractiveStory(props: {
  description?: string;
  initialValue: string;
  options?: readonly { label: string; value: string }[];
  showErrorMessage?: boolean;
}): React.JSX.Element {
  const [value, setValue] = useState(props.initialValue);

  return (
    <div className="w-full max-w-5xl">
      <AutoSaveSelectField
        id="storybook-auto-save-select"
        label="Commit email"
        onSave={async (nextValue) => {
          await systemSleeper.sleep(900);

          if (nextValue === "oss@example.com") {
            throw new Error("Could not update GitHub preferred email.");
          }

          setValue(nextValue);
        }}
        options={props.options ?? DefaultOptions}
        value={value}
        {...(props.description === undefined ? {} : { description: props.description })}
        {...(props.showErrorMessage === undefined
          ? {}
          : { showErrorMessage: props.showErrorMessage })}
      />
    </div>
  );
}

export const Default: Story = {
  render: () => <InteractiveStory initialValue="mistle-user@example.com" showErrorMessage={true} />,
};

export const WithDescription: Story = {
  render: () => (
    <InteractiveStory
      description="Choose a different option to trigger autosave. The spinner and saved check render inside the select trigger."
      initialValue="mistle-user@example.com"
      showErrorMessage={true}
    />
  ),
};

export const WithoutOptions: Story = {
  render: () => (
    <div className="w-full max-w-5xl">
      <AutoSaveSelectField
        id="storybook-auto-save-select-empty"
        label="Commit email"
        onSave={async () => {}}
        options={[]}
        value=""
      />
    </div>
  ),
};
