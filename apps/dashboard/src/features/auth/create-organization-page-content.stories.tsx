import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { expect, within } from "storybook/test";

import { AuthPageShell, AuthPageWidths } from "./auth-page-shell.js";
import { CreateOrganizationPageContent } from "./create-organization-page-content.js";

type CreateOrganizationPageStoryArgs = ComponentProps<typeof CreateOrganizationPageContent>;

function CreateOrganizationPageStory(args: CreateOrganizationPageStoryArgs): React.JSX.Element {
  return (
    <AuthPageShell maxWidthClass={AuthPageWidths.SM} title="Create an organization">
      <CreateOrganizationPageContent {...args} />
    </AuthPageShell>
  );
}

const meta = {
  title: "Dashboard/Auth/CreateOrganizationPage",
  component: CreateOrganizationPageStory,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    createOrganizationError: null,
    isCreatingOrganization: false,
    isSigningOut: false,
    onCancel: () => {},
    onCreateOrganization: () => {},
    onOrganizationNameChange: () => {},
    onSignOut: null,
    organizationName: "",
    organizationNameError: null,
  },
} satisfies Meta<typeof CreateOrganizationPageStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const OptionalWithCancel: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await expect(canvas.getByLabelText("Organization name")).toHaveFocus();
    await expect(canvas.getByRole("button", { name: "Cancel" })).toBeVisible();
    await expect(canvas.queryByRole("button", { name: "Sign Out" })).not.toBeInTheDocument();
  },
};

export const MandatoryWithSignOut: Story = {
  render: (args) => <CreateOrganizationPageStory {...args} onCancel={null} onSignOut={() => {}} />,
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "Sign Out" })).toBeVisible();
    await expect(canvas.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  },
};

export const ValidationError: Story = {
  args: {
    organizationNameError: "Organization name is required.",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const input = canvas.getByPlaceholderText("Organization name");
    await expect(input).toBeVisible();
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(canvas.getByText("Organization name is required.")).toBeVisible();
  },
};

export const CreateError: Story = {
  args: {
    createOrganizationError: "Unable to create organization.",
    organizationName: "Mistle Labs",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await expect(canvas.getByPlaceholderText("Organization name")).toBeVisible();
    await expect(canvas.getByText("Unable to create organization.")).toBeVisible();
  },
};

export const Creating: Story = {
  args: {
    isCreatingOrganization: true,
    organizationName: "Mistle Labs",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "Creating organization..." })).toBeDisabled();
  },
};
