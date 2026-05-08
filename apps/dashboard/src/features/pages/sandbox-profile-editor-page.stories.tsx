import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import {
  DefaultSandboxProfileEditorStoryArgs,
  SandboxProfileEditorPageStory,
} from "./sandbox-profile-editor-story-support.js";

const meta = {
  title: "Dashboard/SandboxProfiles/Editor/Overview",
  component: SandboxProfileEditorPageStory,
  decorators: [withDashboardPageStory],
  render: function RenderStory(args): React.JSX.Element {
    return <SandboxProfileEditorPageStory {...args} />;
  },
  args: DefaultSandboxProfileEditorStoryArgs,
} satisfies Meta<typeof SandboxProfileEditorPageStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Published: Story = {
  args: {
    lifecycleState: "published",
  },
};

export const DraftSaveFailure: Story = {
  args: {
    setupScriptDraft: `#!/usr/bin/env bash
set -euo pipefail

pnpm install
pnpm dev:bootstrap
pnpm lint`,
    draftSaveErrorMessage: "Saving draft failed. Please try again later.",
  },
};
