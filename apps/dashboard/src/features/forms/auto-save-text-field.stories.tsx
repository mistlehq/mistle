import { systemSleeper } from "@mistle/time";
import { FieldDescription } from "@mistle/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type React from "react";

import { withDashboardCenteredSurface } from "../../storybook/decorators.js";
import { AutoSaveTextField, type AutoSaveTextFieldErrorState } from "./auto-save-text-field.js";

type StoryHarnessProps = {
  initialValue: string;
  description?: string;
  placeholder?: string;
  errorMode?: "none" | "save" | "validation";
};

function StoryHarness(input: StoryHarnessProps): React.JSX.Element {
  const [errorMode, setErrorMode] = useState(input.errorMode ?? "none");
  const initialErrorState = resolveStoryErrorState(errorMode);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 rounded-xl border bg-white p-6">
      <AutoSaveTextField
        description={
          input.description ??
          "Shown across the dashboard. Saving begins when focus leaves the field."
        }
        initialErrorState={initialErrorState}
        id="storybook-auto-save-display-name"
        initialValue={input.initialValue}
        label="Display name"
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
        <div className="flex flex-wrap items-center gap-4">
          <span className="font-medium">Error preview</span>
          <label className="flex items-center gap-2">
            <input
              checked={errorMode === "none"}
              name="error-mode"
              onChange={() => {
                setErrorMode("none");
              }}
              type="radio"
            />
            None
          </label>
          <label className="flex items-center gap-2">
            <input
              checked={errorMode === "validation"}
              name="error-mode"
              onChange={() => {
                setErrorMode("validation");
              }}
              type="radio"
            />
            Validation
          </label>
          <label className="flex items-center gap-2">
            <input
              checked={errorMode === "save"}
              name="error-mode"
              onChange={() => {
                setErrorMode("save");
              }}
              type="radio"
            />
            Save
          </label>
        </div>
        <FieldDescription>
          <span className="block">
            Validation error: choose <strong>Validation</strong>, or type fewer than 3 characters
            and blur.
          </span>
          <span className="block">
            Save error: choose <strong>Save</strong>, or type
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
    initialValue: "Mistle Developer",
  },
};

function resolveStoryErrorState(
  errorMode: StoryHarnessProps["errorMode"],
): AutoSaveTextFieldErrorState | null {
  if (errorMode === "validation") {
    return {
      kind: "validation",
      message: "Display name is required.",
    };
  }

  if (errorMode === "save") {
    return {
      kind: "save",
      message: "Could not update display name.",
    };
  }

  return null;
}
