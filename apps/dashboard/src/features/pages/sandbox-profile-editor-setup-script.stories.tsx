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
  render: function RenderStory(args): React.JSX.Element {
    return <SandboxProfileEditorPageStory {...args} />;
  },
  args: DefaultSandboxProfileEditorStoryArgs,
} satisfies Meta<typeof SandboxProfileEditorPageStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const EmptySetupScript: Story = {
  args: {
    initialBindings: [StoryBindings[0], StoryBindings[1]],
    setupScript: "",
    setupScriptAuthoringState: "available",
  },
};

export const AuthoringEntry: Story = {
  args: {
    initialBindings: [StoryBindings[0], StoryBindings[1]],
    setupScriptAuthoringState: "available",
  },
};

export const AuthoringStarting: Story = {
  args: {
    initialBindings: [StoryBindings[0], StoryBindings[1]],
    setupScriptAuthoringPanelState: "starting",
    setupScriptAuthoringState: "starting",
  },
};

export const AuthoringPanelReady: Story = {
  args: {
    initialBindings: [StoryBindings[0], StoryBindings[1]],
    setupScriptAuthoringPanelState: "ready",
    setupScriptAuthoringState: "available",
  },
};

export const AuthoringPanelWithDraft: Story = {
  args: {
    initialBindings: [StoryBindings[0], StoryBindings[1]],
    setupScriptAuthoringPanelState: "proposed-script",
    setupScriptAuthoringState: "available",
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
