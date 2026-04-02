import { systemSleeper } from "@mistle/time";
import { FieldDescription } from "@mistle/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type React from "react";

import { withDashboardCenteredSurface } from "../../storybook/decorators.js";
import {
  AutoSaveEditableHeading,
  type AutoSaveEditableHeadingProps,
} from "./auto-save-editable-heading.js";

type StoryHarnessProps = Pick<
  AutoSaveEditableHeadingProps,
  "savedValue" | "placeholder" | "maxWidthClassName" | "headingClassName" | "inputClassName"
> & {
  saveError?: string;
};

function StoryHarness(input: StoryHarnessProps): React.JSX.Element {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 rounded-xl border bg-white p-6">
      <AutoSaveEditableHeading
        ariaLabel="Display name"
        editButtonLabel="Edit display name"
        headingClassName={input.headingClassName}
        {...(input.saveError === undefined ? {} : { saveError: input.saveError })}
        savedValue={input.savedValue}
        inputClassName={input.inputClassName}
        maxWidthClassName={input.maxWidthClassName}
        onSave={async (nextValue) => {
          await systemSleeper.sleep(900);

          if (nextValue.trim().toLowerCase() === "explode") {
            throw new Error("Could not update display name.");
          }
        }}
        placeholder={input.placeholder ?? "Display name"}
        validate={(nextValue) => {
          if (nextValue.trim().length === 0) {
            return "Display name is required.";
          }

          if (nextValue.trim().length < 3) {
            return "Display name must be at least 3 characters.";
          }

          return null;
        }}
      />

      <div className="flex flex-col gap-2 text-sm">
        <FieldDescription>
          <span className="block">
            Validation error: click the pencil, clear the value, and blur.
          </span>
          <span className="block">
            Save error: pass{" "}
            <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">saveError</code>
            or click the pencil, type
            <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">explode</code>
            and blur.
          </span>
        </FieldDescription>
      </div>
    </div>
  );
}

const meta = {
  title: "Dashboard/Forms/AutoSaveEditableHeading",
  component: StoryHarness,
  decorators: [withDashboardCenteredSurface],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof StoryHarness>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    savedValue: "Repo Maintainer",
  },
};
