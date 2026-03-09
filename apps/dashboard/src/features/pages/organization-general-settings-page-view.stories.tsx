import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type React from "react";
import { expect, userEvent, within } from "storybook/test";

import { withDashboardPageWidth } from "../../storybook/decorators.js";
import { OrganizationGeneralSettingsPageView } from "./organization-general-settings-page-view.js";

const meta = {
  title: "Dashboard/Pages/OrganizationGeneralSettingsPageView",
  component: OrganizationGeneralSettingsPageView,
  decorators: [withDashboardPageWidth],
  args: {
    hasDirtyChanges: false,
    isLoading: false,
    isSaving: false,
    loadErrorMessage: null,
    name: "Mistle Labs",
    nameErrorMessage: null,
    onCancelChanges: () => {},
    onNameChange: () => {},
    onRetryLoad: () => {},
    onSaveChanges: () => {},
    saveErrorMessage: null,
    saveSuccess: false,
  },
} satisfies Meta<typeof OrganizationGeneralSettingsPageView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Loading: Story = {
  args: {
    isLoading: true,
  },
};

export const LoadError: Story = {
  args: {
    loadErrorMessage: "Could not load organization settings.",
  },
};

export const DirtyChanges: Story = {
  args: {
    hasDirtyChanges: true,
    name: "Mistle Storybook Labs",
  },
};

export const ValidationError: Story = {
  args: {
    hasDirtyChanges: true,
    name: "",
    nameErrorMessage: "Organization name is required.",
  },
};

export const Saving: Story = {
  args: {
    hasDirtyChanges: true,
    isSaving: true,
    name: "Mistle Storybook Labs",
  },
};

export const SaveError: Story = {
  args: {
    hasDirtyChanges: true,
    name: "Mistle Storybook Labs",
    saveErrorMessage: "Could not update organization settings.",
  },
};

export const Saved: Story = {
  args: {
    saveSuccess: true,
  },
};

export const InteractiveEditing: Story = {
  render: function RenderStory(): React.JSX.Element {
    const initialName = "Mistle Labs";
    const [name, setName] = useState(initialName);
    const [saveSuccess, setSaveSuccess] = useState(false);

    const normalizedName = name.trim();
    const hasDirtyChanges = normalizedName !== initialName;
    const nameErrorMessage = normalizedName.length === 0 ? "Organization name is required." : null;

    function handleCancelChanges(): void {
      setName(initialName);
      setSaveSuccess(false);
    }

    function handleSaveChanges(): void {
      setSaveSuccess(true);
    }

    return (
      <OrganizationGeneralSettingsPageView
        hasDirtyChanges={hasDirtyChanges}
        isLoading={false}
        isSaving={false}
        loadErrorMessage={null}
        name={name}
        nameErrorMessage={nameErrorMessage}
        onCancelChanges={handleCancelChanges}
        onNameChange={(nextValue) => {
          setName(nextValue);
          setSaveSuccess(false);
        }}
        onRetryLoad={() => {}}
        onSaveChanges={handleSaveChanges}
        saveErrorMessage={null}
        saveSuccess={saveSuccess}
      />
    );
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText("Organization name");
    const saveButton = canvas.getByRole("button", { name: "Save" });
    const cancelButton = canvas.getByRole("button", { name: "Cancel" });

    await expect(saveButton).toBeDisabled();
    await expect(cancelButton).toBeDisabled();

    await userEvent.clear(input);
    await userEvent.type(input, "Mistle Storybook Labs");
    await expect(saveButton).toBeEnabled();
    await expect(cancelButton).toBeEnabled();
    await userEvent.click(saveButton);
    await expect(canvas.getByRole("button", { name: "Saved" })).toBeVisible();
    await userEvent.clear(input);
    await userEvent.type(input, "Draft Labs");
    await userEvent.click(cancelButton);
    await expect(canvas.getByDisplayValue("Mistle Labs")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Save" })).toBeDisabled();
  },
};

export const InteractiveRetryAndValidation: Story = {
  render: function RenderStory(): React.JSX.Element {
    const initialName = "Mistle Labs";
    const [isLoaded, setIsLoaded] = useState(false);
    const [name, setName] = useState(initialName);
    const [saveSuccess, setSaveSuccess] = useState(false);

    const normalizedName = name.trim();
    const hasDirtyChanges = normalizedName !== initialName;
    const nameErrorMessage = normalizedName.length === 0 ? "Organization name is required." : null;

    return (
      <OrganizationGeneralSettingsPageView
        hasDirtyChanges={hasDirtyChanges}
        isLoading={false}
        isSaving={false}
        loadErrorMessage={isLoaded ? null : "Could not load organization settings."}
        name={name}
        nameErrorMessage={nameErrorMessage}
        onCancelChanges={() => {
          setName(initialName);
          setSaveSuccess(false);
        }}
        onNameChange={(nextValue) => {
          setName(nextValue);
          setSaveSuccess(false);
        }}
        onRetryLoad={() => {
          setIsLoaded(true);
        }}
        onSaveChanges={() => {
          setSaveSuccess(true);
        }}
        saveErrorMessage={null}
        saveSuccess={saveSuccess}
      />
    );
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("Could not load organization settings.")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Retry" }));

    const input = canvas.getByLabelText("Organization name");
    const saveButton = canvas.getByRole("button", { name: "Save" });

    await expect(input).toBeVisible();
    await userEvent.clear(input);
    await expect(canvas.getByText("Organization name is required.")).toBeVisible();
    await expect(saveButton).toBeDisabled();

    await userEvent.type(input, "Mistle Labs SG");
    await expect(canvas.queryByText("Organization name is required.")).not.toBeInTheDocument();
    await expect(saveButton).toBeEnabled();
    await userEvent.click(saveButton);
    await expect(canvas.getByRole("button", { name: "Saved" })).toBeVisible();
  },
};
