import { systemSleeper } from "@mistle/time";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type React from "react";
import { useState } from "react";

import { AutoSaveStoryFrame } from "../../storybook/auto-save-story-support.js";
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
  initialValue: string;
  options?: readonly { label: string; value: string }[];
  showErrorMessage?: boolean;
}): React.JSX.Element {
  const [value, setValue] = useState(props.initialValue);

  return (
    <AutoSaveStoryFrame instructions="Choose a different option to trigger autosave. The spinner and saved check render inside the select trigger.">
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
        {...(props.showErrorMessage === undefined
          ? {}
          : { showErrorMessage: props.showErrorMessage })}
      />
    </AutoSaveStoryFrame>
  );
}

export const Default: Story = {
  render: () => <InteractiveStory initialValue="mistle-user@example.com" showErrorMessage={true} />,
};

export const WithoutOptions: Story = {
  render: () => (
    <AutoSaveStoryFrame instructions="When there are no selectable values, the field renders a neutral none state instead of a trigger.">
      <AutoSaveSelectField
        id="storybook-auto-save-select-empty"
        label="Commit email"
        onSave={async () => {}}
        options={[]}
        value=""
      />
    </AutoSaveStoryFrame>
  ),
};
