import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import { SettingsImageField } from "./settings-image-field.js";

const meta = {
  title: "Dashboard/Settings/Shared/SettingsImageField",
  component: SettingsImageField,
  decorators: [withDashboardPageStory],
  args: {
    alt: "Mistle profile image",
    busy: false,
    busyAnnouncement: "Updating profile image",
    editLabel: "Edit profile image",
    errorMessage: null,
    fallbackInitial: "U",
    imageUrl: null,
    label: "Avatar",
    name: "Mistle Developer",
    onDelete: async () => {},
    onUpload: async () => {},
    removeLabel: "Remove profile image",
    uploadLabel: "Upload profile image",
  },
} satisfies Meta<typeof SettingsImageField>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const WithImage: Story = {
  args: {
    imageUrl: "https://images.example.com/mistle-profile.webp",
  },
};

export const Busy: Story = {
  args: {
    busy: true,
  },
};

export const Error: Story = {
  args: {
    errorMessage: "Image upload must be 5242880 bytes or smaller.",
  },
};

export const OrganizationLogoVariant: Story = {
  args: {
    alt: "Mistle Labs logo",
    busyAnnouncement: "Updating organization logo",
    editLabel: "Edit organization logo",
    fallbackInitial: "O",
    label: "Logo",
    name: "Mistle Labs",
    removeLabel: "Remove organization logo",
    uploadLabel: "Upload organization logo",
  },
};
