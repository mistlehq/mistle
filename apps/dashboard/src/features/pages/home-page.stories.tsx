import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import { HomePageStoryModels } from "./home-page-view-model.js";
import { HomePageShell, HomePageView } from "./home-page-view.js";

const meta = {
  title: "Dashboard/Home/Page",
  component: HomePageView,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  decorators: [withDashboardPageStory],
  args: {
    onboarding: HomePageStoryModels.addIntegrations,
  },
  render: function RenderStory(args): React.JSX.Element {
    return (
      <HomePageShell>
        <HomePageView {...args} />
      </HomePageShell>
    );
  },
} satisfies Meta<typeof HomePageView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const AddIntegrations: Story = {};

export const SetUpAProfile: Story = {
  args: {
    onboarding: HomePageStoryModels.setUpProfile,
  },
};

export const CompleteYourProfile: Story = {
  args: {
    onboarding: HomePageStoryModels.completeProfile,
  },
};

export const LaunchFirstSession: Story = {
  args: {
    onboarding: HomePageStoryModels.launchFirstSession,
  },
};

export const CreateAnAutomation: Story = {
  args: {
    onboarding: HomePageStoryModels.createAutomation,
  },
};

export const AddAWebhookIntegration: Story = {
  args: {
    onboarding: HomePageStoryModels.addWebhookIntegration,
  },
};

export const Completed: Story = {
  args: {
    onboarding: HomePageStoryModels.completed,
  },
};
