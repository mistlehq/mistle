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
    errorMessage: null,
    fallbackInitial: "U",
    imageUrl: null,
    imageName: "profile image",
    label: "Avatar",
    name: "Mistle Developer",
    onDelete: async () => {},
    onUpload: async () => {},
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
    fallbackInitial: "O",
    imageName: "organization logo",
    label: "Logo",
    name: "Mistle Labs",
  },
};
