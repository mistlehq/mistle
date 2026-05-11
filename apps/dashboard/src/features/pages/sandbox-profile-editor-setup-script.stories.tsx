import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import {
  DefaultSandboxProfileEditorStoryArgs,
  SandboxProfileEditorPageStory,
  StoryBindings,
} from "./sandbox-profile-editor-story-support.js";

const meta = {
  title: "Dashboard/SandboxProfiles/Editor/Setup Script",
  component: SandboxProfileEditorPageStory,
  decorators: [withDashboardPageStory],
  parameters: {
    layout: "fullscreen",
  },
  render: function RenderStory(args): React.JSX.Element {
    return <SandboxProfileEditorPageStory {...args} />;
  },
  args: {
    ...DefaultSandboxProfileEditorStoryArgs,
    setupAssistantState: "available",
  },
} satisfies Meta<typeof SandboxProfileEditorPageStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const EmptySetupScript: Story = {
  args: {
    initialBindings: [StoryBindings[0], StoryBindings[1]],
    setupScript: "",
  },
};

export const SetupAssistantEntry: Story = {
  args: {
    initialBindings: [StoryBindings[0], StoryBindings[1]],
  },
};

export const SetupAssistantStarting: Story = {
  args: {
    initialBindings: [StoryBindings[0], StoryBindings[1]],
    setupAssistantPanelState: "starting",
    setupAssistantState: "starting",
  },
};

export const SetupAssistantRequiresAgent: Story = {
  args: {
    initialBindings: [StoryBindings[1]],
    setupAssistantState: "disabled",
  },
};

export const SetupAssistantAgentRequiredNotice: Story = {
  args: {
    initialBindings: [StoryBindings[1]],
    setupAssistantErrorMessage: "Add an agent integration before using Setup Assistant.",
    setupAssistantState: "disabled",
  },
};

export const SetupAssistantPanelReady: Story = {
  args: {
    initialBindings: [StoryBindings[0], StoryBindings[1]],
    setupAssistantPanelState: "ready",
  },
};

export const SetupAssistantPanelWithDraft: Story = {
  args: {
    initialBindings: [StoryBindings[0], StoryBindings[1]],
    setupAssistantPanelState: "proposed-script",
  },
};

export const TestStarting: Story = {
  args: {
    setupScriptTestStatus: "starting",
  },
};

export const TestRunning: Story = {
  args: {
    setupScriptTestStatus: "running",
  },
};

export const TestSucceeded: Story = {
  args: {
    setupScriptTestStatus: "success",
  },
};

export const TestFailed: Story = {
  args: {
    setupScriptTestStatus: "failed",
  },
};

export const TestUnavailablePublished: Story = {
  args: {
    lifecycleState: "published",
    setupScriptTestStatus: "idle",
  },
};
