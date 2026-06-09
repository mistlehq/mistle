import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

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

export const UnsavedPublicGitHubSource: Story = {
  name: "Unsaved Public GitHub Source",
  args: {
    initialBindings: StoryBindings.filter((binding) => binding.kind !== "git"),
    skillsState: "no-source",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);

    await userEvent.click(canvas.getByRole("combobox", { name: "Source repository" }));
    await userEvent.click(await body.findByRole("option", { name: "Add public GitHub repo" }));
    await userEvent.type(
      body.getByRole("textbox", { name: "Repository URL" }),
      "https://github.com/acme/public-skills",
    );
    await userEvent.click(body.getByRole("button", { name: "Add repository" }));

    await expect(canvas.getByText("Draft will be saved")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Load skills" }));

    await expect(body.getByRole("heading", { name: "Load skills?" })).toBeVisible();
    await expect(
      body.getByText(
        "Mistle will save this draft first, then load skills from the selected skills source.",
      ),
    ).toBeVisible();
  },
};

export const PublicGitHubSource: Story = {
  name: "Public GitHub Source",
  args: {
    initialBindings: StoryBindings.filter((binding) => binding.kind !== "git"),
    skillsState: "public-source",
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
