import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { withDashboardPageWidth } from "../../storybook/decorators.js";
import { EditableHeading } from "./editable-heading.js";

function StoryHarness(input: {
  value: string;
  ariaLabel: string;
  editButtonLabel: string;
  placeholder?: string;
  errorMessage?: string;
  initiallyEditing?: boolean;
  maxWidthClassName?: string;
  headingTag?: "div" | "h1" | "h2";
  headingClassName?: string;
  inputClassName?: string;
}): React.JSX.Element {
  const [isEditing, setIsEditing] = useState(input.initiallyEditing ?? false);
  const [draftValue, setDraftValue] = useState(input.value);
  const [value, setValue] = useState(input.value);

  return (
    <EditableHeading
      ariaLabel={input.ariaLabel}
      cancelOnEscape={true}
      draftValue={draftValue}
      editButtonLabel={input.editButtonLabel}
      errorMessage={input.errorMessage}
      {...(input.headingClassName === undefined
        ? {}
        : { headingClassName: input.headingClassName })}
      {...(input.headingTag === undefined ? {} : { headingTag: input.headingTag })}
      {...(input.inputClassName === undefined ? {} : { inputClassName: input.inputClassName })}
      isEditing={isEditing}
      maxWidthClassName={input.maxWidthClassName}
      onCancel={() => {
        setDraftValue(value);
        setIsEditing(false);
      }}
      onCommit={() => {
        setValue(draftValue.trim().length === 0 ? value : draftValue.trim());
        setIsEditing(false);
      }}
      onDraftValueChange={setDraftValue}
      onEditStart={() => {
        setIsEditing(true);
      }}
      placeholder={input.placeholder}
      saveDisabled={false}
      value={value}
    />
  );
}

const meta = {
  title: "Dashboard/Shared/EditableHeading",
  component: StoryHarness,
  decorators: [withDashboardPageWidth],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof StoryHarness>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    value: "Repo Maintainer",
    ariaLabel: "Profile name",
    editButtonLabel: "Edit profile name",
  },
};

export const Editing: Story = {
  args: {
    value: "GitHub pushes to repo triage",
    ariaLabel: "Automation name",
    editButtonLabel: "Edit automation name",
    initiallyEditing: true,
    inputClassName: "text-base font-medium",
    maxWidthClassName: "max-w-4xl",
    placeholder: "Automation name",
  },
};

export const SectionHeading: Story = {
  args: {
    value: "Connection overview",
    ariaLabel: "Section heading",
    editButtonLabel: "Edit section heading",
    headingClassName: "text-base font-medium leading-none",
    headingTag: "h2",
    inputClassName: "text-base font-medium",
  },
};

export const WithError: Story = {
  args: {
    value: "",
    ariaLabel: "Automation name",
    editButtonLabel: "Edit automation name",
    errorMessage: "Automation name is required.",
    initiallyEditing: true,
    inputClassName: "text-base font-medium",
    maxWidthClassName: "max-w-4xl",
    placeholder: "Automation name",
  },
};
