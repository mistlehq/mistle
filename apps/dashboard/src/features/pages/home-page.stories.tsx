import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps } from "react";
import { MemoryRouter } from "react-router";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import { HomePageFrame } from "./home-page-frame.js";
import { HomePageStoryModels } from "./home-page-view-model.js";
import { HomePageView } from "./home-page-view.js";
import { NewSessionForm } from "./new-session-form.js";
import {
  buildSandboxInstanceListItemFixture,
  buildStoryLaunchableSandboxProfile,
  createSessionsPageStoryQueryClient,
} from "./sessions-page.story-fixtures.js";

function HomePageStoryFrame(args: ComponentProps<typeof HomePageView>): React.JSX.Element {
  return (
    <HomePageFrame onboardingState={args.onboarding.state} showMistleCloudBetaNotice>
      <HomePageView {...args} />
    </HomePageFrame>
  );
}

function CompletedHomePageStory(args: ComponentProps<typeof HomePageView>): React.JSX.Element {
  const queryClient = createSessionsPageStoryQueryClient({
    launchableProfiles: [
      buildStoryLaunchableSandboxProfile({
        id: "sbp_profile_multi_repo",
        displayName: "Engineering Sandbox",
        repositoryOptions: [
          {
            id: "/root/acme/repo-1",
            label: "acme/repo-1",
            path: "/root/acme/repo-1",
          },
          {
            id: "/root/acme/repo-2",
            label: "acme/repo-2",
            path: "/root/acme/repo-2",
          },
        ],
      }),
      buildStoryLaunchableSandboxProfile({
        id: "sbp_profile_no_repo",
        displayName: "General Sandbox",
        latestVersion: 2,
      }),
    ],
  });

  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/"]}>
        <HomePageStoryFrame {...args} createSessionForm={<NewSessionForm />} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const meta = {
  title: "Dashboard/Home/Page",
  component: HomePageView,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  decorators: [withDashboardPageStory],
  args: {
    createSessionForm: null,
    onboarding: HomePageStoryModels.addIntegrations,
    recentSessions: [],
  },
  render: function RenderStory(args): React.JSX.Element {
    return <HomePageStoryFrame {...args} />;
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

export const CreateATrigger: Story = {
  args: {
    onboarding: HomePageStoryModels.createTrigger,
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
    recentSessions: [
      buildSandboxInstanceListItemFixture({
        id: "sbi_home_story_recent_1",
        title: "Investigate failing build",
        sandboxProfileDisplayName: "Engineering Sandbox",
        createdAt: "2026-05-13T06:30:00.000Z",
        updatedAt: "2026-05-13T07:10:00.000Z",
      }),
      buildSandboxInstanceListItemFixture({
        id: "sbi_home_story_recent_2",
        title: "Review onboarding copy changes",
        sandboxProfileDisplayName: "General Sandbox",
        createdAt: "2026-05-12T11:45:00.000Z",
        updatedAt: "2026-05-12T12:20:00.000Z",
      }),
      buildSandboxInstanceListItemFixture({
        id: "sbi_home_story_recent_3",
        title: null,
        sandboxProfileDisplayName: "Engineering Sandbox",
        createdAt: "2026-05-11T03:20:00.000Z",
        updatedAt: "2026-05-11T04:00:00.000Z",
      }),
    ],
  },
  render: function RenderCompletedStory(args): React.JSX.Element {
    return <CompletedHomePageStory {...args} />;
  },
};
