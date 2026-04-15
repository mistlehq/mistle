import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  AutoSaveStoryFrame,
  useAutoSaveStoryValue,
  validateAutoSaveDisplayName,
} from "../../storybook/auto-save-story-support.js";
import { withDashboardCenteredStory } from "../../storybook/decorators.js";
import {
  AutoSaveEditableHeading,
  type AutoSaveEditableHeadingProps,
} from "./auto-save-editable-heading.js";

type StoryHarnessProps = Pick<
  AutoSaveEditableHeadingProps,
  "value" | "placeholder" | "maxWidthClassName" | "headingClassName" | "inputClassName"
> & {
  errorMessage?: string;
};

function StoryHarness(input: StoryHarnessProps): React.JSX.Element {
  const example = useAutoSaveStoryValue(input.value);

  return (
    <AutoSaveStoryFrame
      instructions={
        <>
          <span className="block">
            Validation error: click the pencil, clear the value, and blur.
          </span>
          <span className="block">
            Save error: pass{" "}
            <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">errorMessage</code>
            or click the pencil, type
            <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">explode</code>
            and blur.
          </span>
        </>
      }
    >
      <ComparisonPane example={example} {...input} />
    </AutoSaveStoryFrame>
  );
}

function ComparisonPane(
  input: StoryHarnessProps & { example: ReturnType<typeof useAutoSaveStoryValue> },
): React.JSX.Element {
  const { example, ...headingProps } = input;

  return (
    <AutoSaveEditableHeading
      ariaLabel="Display name"
      editButtonLabel="Edit display name"
      {...(headingProps.errorMessage === undefined
        ? {}
        : { errorMessage: headingProps.errorMessage })}
      {...(headingProps.headingClassName === undefined
        ? {}
        : { headingClassName: headingProps.headingClassName })}
      value={example.value}
      {...(headingProps.inputClassName === undefined
        ? {}
        : { inputClassName: headingProps.inputClassName })}
      {...(headingProps.maxWidthClassName === undefined
        ? {}
        : { maxWidthClassName: headingProps.maxWidthClassName })}
      onSave={example.onSave}
      placeholder={headingProps.placeholder ?? "Display name"}
      validate={validateAutoSaveDisplayName}
    />
  );
}

const meta = {
  title: "Dashboard/Forms/AutoSaveEditableHeading",
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
    value: "Repo Maintainer",
  },
};
