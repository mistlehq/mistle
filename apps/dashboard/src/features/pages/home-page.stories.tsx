import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import { HomePageStoryModels } from "./home-page-view-model.js";
import { HomePageView } from "./home-page-view.js";

const meta = {
  title: "Dashboard/Home/Page",
  component: HomePageView,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  decorators: [withDashboardPageStory],
  args: {
    onboarding: HomePageStoryModels.noAiConnection,
  },
  render: function RenderStory(args): React.JSX.Element {
    return <HomePageView {...args} />;
  },
} satisfies Meta<typeof HomePageView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const AddIntegrations: Story = {};

export const SetUpAProfile: Story = {
  args: {
    onboarding: HomePageStoryModels.missingProfile,
  },
};

export const CompleteYourProfile: Story = {
  args: {
    onboarding: HomePageStoryModels.profileNeedsBinding,
  },
};

export const LaunchFirstSession: Story = {
  args: {
    onboarding: HomePageStoryModels.readyForFirstSession,
  },
};

export const CreateAnAutomation: Story = {
  args: {
    onboarding: HomePageStoryModels.readyForFirstAutomation,
  },
};

export const Activated: Story = {
  args: {
    onboarding: HomePageStoryModels.activated,
  },
};

export const AddAWebhookIntegration: Story = {
  args: {
    onboarding: HomePageStoryModels.automationRequiresWebhookIntegration,
  },
};
