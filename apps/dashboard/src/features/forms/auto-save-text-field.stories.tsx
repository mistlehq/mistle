import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  AutoSaveStoryFrame,
  useAutoSaveStoryValue,
  validateAutoSaveDisplayName,
} from "../../storybook/auto-save-story-support.js";
import { withDashboardCenteredStory } from "../../storybook/decorators.js";
import { AutoSaveTextField } from "./auto-save-text-field.js";

type StoryHarnessProps = {
  value: string;
  description?: string;
  placeholder?: string;
};

function StoryHarness(input: StoryHarnessProps): React.JSX.Element {
  const { onSave, value } = useAutoSaveStoryValue(input.value);

  return (
    <AutoSaveStoryFrame
      instructions={
        <>
          <span className="block">Validation error: type fewer than 3 characters and blur.</span>
          <span className="block">
            Save error: type
            <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">explode</code>
            and blur.
          </span>
        </>
      }
    >
      <AutoSaveTextField
        description={
          input.description ??
          "Shown across the dashboard. Saving begins when focus leaves the field."
        }
        id="storybook-auto-save-display-name"
        value={value}
        label="Display name"
        onSave={onSave}
        placeholder={input.placeholder ?? "Display name"}
        validate={validateAutoSaveDisplayName}
      />
    </AutoSaveStoryFrame>
  );
}

const meta = {
  title: "Dashboard/Forms/Autosave Text Field",
  component: StoryHarness,
  decorators: [withDashboardCenteredStory],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof StoryHarness>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    value: "Mistle Developer",
  },
};
