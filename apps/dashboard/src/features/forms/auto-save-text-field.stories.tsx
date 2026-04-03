import { systemSleeper } from "@mistle/time";
import { FieldDescription } from "@mistle/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { withDashboardCenteredSurface } from "../../storybook/decorators.js";
import { AutoSaveTextField } from "./auto-save-text-field.js";

type StoryHarnessProps = {
  value: string;
  description?: string;
  placeholder?: string;
};

function StoryHarness(input: StoryHarnessProps): React.JSX.Element {
  const [value, setValue] = useState(input.value);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 rounded-xl border bg-white p-6">
      <AutoSaveTextField
        description={
          input.description ??
          "Shown across the dashboard. Saving begins when focus leaves the field."
        }
        id="storybook-auto-save-display-name"
        value={value}
        label="Display name"
        onSave={async (nextValue) => {
          await systemSleeper.sleep(900);

          if (nextValue.trim().toLowerCase() === "explode") {
            throw new Error("Could not update display name.");
          }

          setValue(nextValue);
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
          <span className="block">Validation error: type fewer than 3 characters and blur.</span>
          <span className="block">
            Save error: type
            <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">explode</code>
            and blur.
          </span>
        </FieldDescription>
      </div>
    </div>
  );
}

const meta = {
  title: "Dashboard/Forms/AutoSaveTextField",
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
    value: "Mistle Developer",
  },
};
