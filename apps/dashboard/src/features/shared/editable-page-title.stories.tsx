import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { withDashboardPageWidth } from "../../storybook/decorators.js";
import { EditablePageTitle } from "./editable-page-title.js";

function StoryHarness(input: {
  title: string;
  ariaLabel: string;
  editButtonLabel: string;
  placeholder?: string;
  errorMessage?: string;
  initiallyEditing?: boolean;
  maxWidthClassName?: string;
}): React.JSX.Element {
  const [isEditing, setIsEditing] = useState(input.initiallyEditing ?? false);
  const [draftValue, setDraftValue] = useState(input.title);
  const [title, setTitle] = useState(input.title);

  return (
    <EditablePageTitle
      ariaLabel={input.ariaLabel}
      cancelOnEscape={true}
      draftValue={draftValue}
      editButtonLabel={input.editButtonLabel}
      errorMessage={input.errorMessage}
      isEditing={isEditing}
      maxWidthClassName={input.maxWidthClassName}
      onCancel={() => {
        setDraftValue(title);
        setIsEditing(false);
      }}
      onCommit={() => {
        setTitle(draftValue.trim().length === 0 ? title : draftValue.trim());
        setIsEditing(false);
      }}
      onDraftValueChange={setDraftValue}
      onEditStart={() => {
        setIsEditing(true);
      }}
      placeholder={input.placeholder}
      saveDisabled={false}
      title={title}
    />
  );
}

const meta = {
  title: "Dashboard/Shared/EditablePageTitle",
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
    title: "Repo Maintainer",
    ariaLabel: "Profile name",
    editButtonLabel: "Edit profile name",
  },
};

export const Editing: Story = {
  args: {
    title: "GitHub pushes to repo triage",
    ariaLabel: "Automation name",
    editButtonLabel: "Edit automation name",
    initiallyEditing: true,
    maxWidthClassName: "max-w-4xl",
    placeholder: "Automation name",
  },
};

export const WithError: Story = {
  args: {
    title: "",
    ariaLabel: "Automation name",
    editButtonLabel: "Edit automation name",
    errorMessage: "Automation name is required.",
    initiallyEditing: true,
    maxWidthClassName: "max-w-4xl",
    placeholder: "Automation name",
  },
};
