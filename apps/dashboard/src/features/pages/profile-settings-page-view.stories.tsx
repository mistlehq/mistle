import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type React from "react";
import { expect, userEvent, within } from "storybook/test";

import { withDashboardPageWidth } from "../../storybook/decorators.js";
import { ProfileSettingsPageView } from "./profile-settings-page-view.js";

const meta = {
  title: "Dashboard/Pages/ProfileSettingsPageView",
  component: ProfileSettingsPageView,
  decorators: [withDashboardPageWidth],
  args: {
    displayName: "Mistle Developer",
    displayNameDraft: "Mistle Developer",
    email: "developer@mistle.so",
    fieldError: null,
    hasDirtyChanges: false,
    onCancelChanges: () => {},
    onDisplayNameChange: () => {},
    onSaveChanges: () => {},
    saveSuccess: false,
    saving: false,
  },
} satisfies Meta<typeof ProfileSettingsPageView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const DirtyChanges: Story = {
  args: {
    displayName: "Mistle Developer",
    displayNameDraft: "Mistle Dashboard Team",
    hasDirtyChanges: true,
  },
};

export const Saving: Story = {
  args: {
    displayNameDraft: "Mistle Dashboard Team",
    hasDirtyChanges: true,
    saving: true,
  },
};

export const SaveError: Story = {
  args: {
    displayNameDraft: "Mistle Dashboard Team",
    fieldError: "Could not update profile.",
    hasDirtyChanges: true,
  },
};

export const Saved: Story = {
  args: {
    saveSuccess: true,
  },
};

export const InteractiveEditing: Story = {
  render: function RenderStory(): React.JSX.Element {
    const initialName = "Mistle Developer";
    const [displayNameDraft, setDisplayNameDraft] = useState(initialName);
    const [saveSuccess, setSaveSuccess] = useState(false);

    const normalizedDisplayName = displayNameDraft.trim();
    const displayName = normalizedDisplayName.length > 0 ? normalizedDisplayName : initialName;
    const hasDirtyChanges = normalizedDisplayName !== initialName;

    function handleCancelChanges(): void {
      setDisplayNameDraft(initialName);
      setSaveSuccess(false);
    }

    function handleSaveChanges(): void {
      setSaveSuccess(true);
    }

    return (
      <ProfileSettingsPageView
        displayName={displayName}
        displayNameDraft={displayNameDraft}
        email="developer@mistle.so"
        fieldError={null}
        hasDirtyChanges={hasDirtyChanges}
        onCancelChanges={handleCancelChanges}
        onDisplayNameChange={(nextValue) => {
          setDisplayNameDraft(nextValue);
          setSaveSuccess(false);
        }}
        onSaveChanges={handleSaveChanges}
        saveSuccess={saveSuccess}
        saving={false}
      />
    );
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText("Display name");
    const saveButton = canvas.getByRole("button", { name: "Save" });
    const cancelButton = canvas.getByRole("button", { name: "Cancel" });

    await expect(saveButton).toBeDisabled();
    await expect(cancelButton).toBeDisabled();

    await userEvent.clear(input);
    await userEvent.type(input, "Mistle Storybook");
    await expect(saveButton).toBeEnabled();
    await expect(cancelButton).toBeEnabled();
    await userEvent.click(saveButton);
    await expect(canvas.getByRole("button", { name: "Saved" })).toBeVisible();
    await userEvent.clear(input);
    await userEvent.type(input, "Mistle Storybook Draft");
    await userEvent.click(cancelButton);
    await expect(canvas.getByDisplayValue("Mistle Developer")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Save" })).toBeDisabled();
  },
};

export const SaveResetsSuccessState: Story = {
  render: function RenderStory(): React.JSX.Element {
    const initialName = "Mistle Developer";
    const [displayNameDraft, setDisplayNameDraft] = useState(initialName);
    const [saveSuccess, setSaveSuccess] = useState(false);

    const normalizedDisplayName = displayNameDraft.trim();
    const displayName = normalizedDisplayName.length > 0 ? normalizedDisplayName : initialName;
    const hasDirtyChanges = normalizedDisplayName !== initialName;

    return (
      <ProfileSettingsPageView
        displayName={displayName}
        displayNameDraft={displayNameDraft}
        email="developer@mistle.so"
        fieldError={null}
        hasDirtyChanges={hasDirtyChanges}
        onCancelChanges={() => {
          setDisplayNameDraft(initialName);
          setSaveSuccess(false);
        }}
        onDisplayNameChange={(nextValue) => {
          setDisplayNameDraft(nextValue);
          setSaveSuccess(false);
        }}
        onSaveChanges={() => {
          setSaveSuccess(true);
        }}
        saveSuccess={saveSuccess}
        saving={false}
      />
    );
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText("Display name");

    await userEvent.clear(input);
    await userEvent.type(input, "Saved Name");
    await userEvent.click(canvas.getByRole("button", { name: "Save" }));
    await expect(canvas.getByRole("button", { name: "Saved" })).toBeVisible();

    await userEvent.type(input, " Updated");
    await expect(canvas.getByRole("button", { name: "Save" })).toBeVisible();
    await expect(canvas.queryByRole("button", { name: "Saved" })).not.toBeInTheDocument();
  },
};
