import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import {
  DefaultSandboxProfileEditorStoryArgs,
  SandboxProfileEditorPageStory,
  StoryBindings,
} from "./sandbox-profile-editor-story-support.js";

const meta = {
  title: "Dashboard/SandboxProfiles/Editor/Skills",
  component: SandboxProfileEditorPageStory,
  decorators: [withDashboardPageStory],
  parameters: {
    layout: "fullscreen",
  },
  render: function RenderStory(args): React.JSX.Element {
    return <SandboxProfileEditorPageStory {...args} />;
  },
  args: DefaultSandboxProfileEditorStoryArgs,
} satisfies Meta<typeof SandboxProfileEditorPageStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Configured: Story = {};

export const SearchableSkills: Story = {
  args: {
    skillsState: "searchable",
  },
};

export const NoSkillsSource: Story = {
  args: {
    skillsState: "no-source",
  },
};

export const SkillsNotLoaded: Story = {
  args: {
    skillsState: "undiscovered",
  },
};

export const NoDiscoveredSkills: Story = {
  args: {
    skillsState: "no-discovered-skills",
  },
};

export const UnsavedIntegrationChanges: Story = {
  args: {
    skillsIntegrationRowsHaveUnpersistedChanges: true,
  },
};

export const UnavailableSourceRepository: Story = {
  args: {
    skillsState: "unavailable-source",
  },
};

export const UnavailableSelectedSkill: Story = {
  args: {
    skillsState: "unavailable-selected-skill",
  },
};

export const NoGitRepositoryBinding: Story = {
  args: {
    initialBindings: StoryBindings.filter((binding) => binding.kind !== "git"),
    skillsState: "no-source",
  },
};
