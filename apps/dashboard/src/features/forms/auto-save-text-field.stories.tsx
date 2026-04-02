import { systemSleeper } from "@mistle/time";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type React from "react";

import { withDashboardCenteredSurface } from "../../storybook/decorators.js";
import { FormPageSection, FormPageStack } from "../shared/form-page.js";
import { FormPageFrame } from "../shared/page-frame.js";
import { AutoSaveTextField } from "./auto-save-text-field.js";

type StoryHarnessProps = {
  initialValue: string;
  description?: string;
  placeholder?: string;
  shouldFailSave?: boolean;
};

function StoryHarness(input: StoryHarnessProps): React.JSX.Element {
  const [shouldFailSave, setShouldFailSave] = useState(input.shouldFailSave ?? false);

  return (
    <FormPageFrame
      description="Single-field editor that validates and saves automatically when focus leaves."
      title="Display name"
    >
      <FormPageStack>
        <FormPageSection>
          <div className="flex flex-col gap-4 p-4">
            <AutoSaveTextField
              description={
                input.description ??
                "Shown across the dashboard. Saving begins when focus leaves the field."
              }
              id="storybook-auto-save-display-name"
              initialValue={input.initialValue}
              label="Display name"
              onSave={async (nextValue) => {
                await systemSleeper.sleep(900);

                if (shouldFailSave || nextValue.trim().toLowerCase() === "explode") {
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

            <label className="flex items-center gap-2 text-sm">
              <input
                checked={shouldFailSave}
                onChange={(event) => {
                  setShouldFailSave(event.target.checked);
                }}
                type="checkbox"
              />
              Force the next save to fail
            </label>
          </div>
        </FormPageSection>
      </FormPageStack>
    </FormPageFrame>
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
    initialValue: "Mistle Developer",
  },
};

export const WithLongerDescription: Story = {
  args: {
    description:
      "This mirrors settings forms where a single text field commits on blur instead of showing an external save bar.",
    initialValue: "Jonathan Low",
  },
};

export const SaveFailure: Story = {
  args: {
    initialValue: "Operations Team",
    shouldFailSave: true,
  },
};
