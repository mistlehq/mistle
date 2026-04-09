import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import type { SandboxProfilesListResult } from "../sandbox-profiles/sandbox-profiles-types.js";
import { SandboxProfilesStoryHarness } from "./sandbox-profiles-story-harness.js";

type SandboxProfilesPageStoryArgs = {
  initialEntries: readonly string[];
  sandboxProfilesList?: SandboxProfilesListResult;
};

function SandboxProfilesPageStory(input: SandboxProfilesPageStoryArgs): React.JSX.Element {
  return (
    <SandboxProfilesStoryHarness
      initialEntries={input.initialEntries}
      {...(input.sandboxProfilesList === undefined
        ? {}
        : { sandboxProfilesList: input.sandboxProfilesList })}
    />
  );
}

const meta = {
  title: "Dashboard/SandboxProfiles/Page",
  component: SandboxProfilesPageStory,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  decorators: [withDashboardPageStory],
  args: {
    initialEntries: ["/sandbox-profiles"],
  },
  render: function RenderStory(args): React.JSX.Element {
    return <SandboxProfilesPageStory {...args} />;
  },
} satisfies Meta<typeof SandboxProfilesPageStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const List: Story = {};

export const CreateDialogFromRoute: Story = {
  args: {
    initialEntries: ["/sandbox-profiles/new"],
  },
};
