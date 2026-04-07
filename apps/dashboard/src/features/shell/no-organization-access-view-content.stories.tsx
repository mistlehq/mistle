import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { AuthPageShell, AuthPageWidths } from "../auth/auth-page-shell.js";
import { NoOrganizationAccessViewContent } from "./no-organization-access-view-content.js";

const meta = {
  title: "Dashboard/Onboarding/NoOrganizationAccessView",
  component: NoOrganizationAccessViewContent,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    createOrganizationError: null,
    isCreatingOrganization: false,
    isSigningOut: false,
    onCreateOrganization: () => {},
    onOrganizationNameChange: () => {},
    onSignOut: () => {},
    organizationName: "",
    organizationNameError: null,
  },
  render: (args) => (
    <AuthPageShell maxWidthClass={AuthPageWidths.SM} title="Create an organization">
      <NoOrganizationAccessViewContent {...args} />
    </AuthPageShell>
  ),
} satisfies Meta<typeof NoOrganizationAccessViewContent>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await expect(canvas.getByLabelText("Organization name")).toHaveFocus();
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
};
