import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { withDashboardCenteredStory } from "../../storybook/decorators.js";
import { MultiSelectStringArrayComboboxField } from "./multi-select-string-array-combobox-field.js";
import { SingleSelectStringComboboxField } from "./single-select-string-combobox-field.js";
import type { StringComboboxOption } from "./string-combobox-options.js";

const RegionOptions: readonly StringComboboxOption[] = [
  {
    label: "us-east-1",
    value: "us-east-1",
  },
  {
    label: "us-west-2",
    value: "us-west-2",
  },
  {
    label: "eu-west-1",
    value: "eu-west-1",
  },
];

const ServiceOptions: readonly StringComboboxOption[] = [
  {
    label: "S3",
    value: "s3",
  },
  {
    label: "STS",
    value: "sts",
  },
  {
    label: "Secrets Manager",
    value: "secretsmanager",
  },
  {
    label: "CloudWatch Logs",
    value: "logs",
  },
];

function ComboboxStoryFrame(input: {
  title: string;
  description: string;
  children: React.JSX.Element;
}): React.JSX.Element {
  return (
    <div className="w-full max-w-2xl rounded-xl border bg-background p-6">
      <div className="mb-4 flex flex-col gap-1">
        <h1 className="text-base font-semibold">{input.title}</h1>
        <p className="text-muted-foreground text-sm">{input.description}</p>
      </div>
      {input.children}
    </div>
  );
}

function SingleSelectStoryHarness(input: {
  value: string | undefined;
  readonly?: boolean;
}): React.JSX.Element {
  const [value, setValue] = useState<string | undefined>(input.value);

  return (
    <ComboboxStoryFrame
      description="Closed state shows the selected label. Reopening clears the search so the full option list is available."
      title="Single-select string combobox field"
    >
      <SingleSelectStringComboboxField
        inputId="storybook-default-region"
        inputLabel="Default region"
        onChange={setValue}
        options={RegionOptions}
        placeholder="Select default region"
        readonly={input.readonly}
        value={value}
      />
    </ComboboxStoryFrame>
  );
}

function MultiSelectStoryHarness(input: {
  value: readonly string[];
  readonly?: boolean;
}): React.JSX.Element {
  const [value, setValue] = useState<readonly string[]>(input.value);

  return (
    <ComboboxStoryFrame
      description="Selected values render as chips while the input stays focused on searching and adding more items."
      title="Multi-select string array combobox field"
    >
      <MultiSelectStringArrayComboboxField
        inputId="storybook-services"
        inputLabel="Services"
        onChange={setValue}
        options={ServiceOptions}
        placeholder="Select services"
        readonly={input.readonly}
        value={value}
      />
    </ComboboxStoryFrame>
  );
}

const meta = {
  title: "Dashboard/Forms/String Combobox Fields",
  decorators: [withDashboardCenteredStory],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const SingleSelectDefaultRegion: Story = {
  render: () => <SingleSelectStoryHarness value="us-east-1" />,
};

export const SingleSelectEmpty: Story = {
  render: () => <SingleSelectStoryHarness value={undefined} />,
};

export const MultiSelectServices: Story = {
  render: () => <MultiSelectStoryHarness value={["s3", "sts"]} />,
};

export const MultiSelectEmpty: Story = {
  render: () => <MultiSelectStoryHarness value={[]} />,
};

export const SingleSelectReadonly: Story = {
  render: () => <SingleSelectStoryHarness readonly={true} value="eu-west-1" />,
};

export const MultiSelectReadonly: Story = {
  render: () => <MultiSelectStoryHarness readonly={true} value={["s3", "logs"]} />,
};
