import { systemSleeper } from "@mistle/time";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useRef, useState } from "react";

import { withDashboardPageWidth } from "../../storybook/decorators.js";
import type { AutoSaveInputVisualStatus } from "./auto-save-input-surface.js";
import { EditableHeading } from "./editable-heading.js";

function StoryHarness(input: {
  value: string;
  ariaLabel: string;
  editButtonLabel: string;
  placeholder?: string;
  errorMessage?: string;
  initiallyEditing?: boolean;
  saveStatus?: AutoSaveInputVisualStatus;
  maxWidthClassName?: string;
  headingTag?: "div" | "h1" | "h2";
  headingClassName?: string;
  inputClassName?: string;
}): React.JSX.Element {
  const [isEditing, setIsEditing] = useState(input.initiallyEditing ?? false);
  const [draftValue, setDraftValue] = useState(input.value);
  const [value, setValue] = useState(input.value);
  const [errorMessage, setErrorMessage] = useState(input.errorMessage);
  const [saveStatus, setSaveStatus] = useState<AutoSaveInputVisualStatus>(
    input.saveStatus ?? "idle",
  );
  const saveSequenceRef = useRef(0);

  return (
    <EditableHeading
      ariaLabel={input.ariaLabel}
      cancelOnEscape={true}
      draftValue={draftValue}
      editButtonLabel={input.editButtonLabel}
      errorMessage={errorMessage}
      {...(input.headingClassName === undefined
        ? {}
        : { headingClassName: input.headingClassName })}
      {...(input.headingTag === undefined ? {} : { headingTag: input.headingTag })}
      {...(input.inputClassName === undefined ? {} : { inputClassName: input.inputClassName })}
      isEditing={isEditing}
      maxWidthClassName={input.maxWidthClassName}
      saveStatus={saveStatus}
      onCancel={() => {
        setDraftValue(value);
        setErrorMessage(input.errorMessage);
        setSaveStatus(input.saveStatus ?? "idle");
        setIsEditing(false);
      }}
      onCommit={() => {
        if (input.saveStatus !== undefined) {
          return;
        }

        const normalizedDraftValue = draftValue.trim();
        if (normalizedDraftValue.length === 0) {
          setErrorMessage("Heading is required.");
          setSaveStatus("idle");
          return;
        }

        const currentSaveSequence = saveSequenceRef.current + 1;
        saveSequenceRef.current = currentSaveSequence;
        setErrorMessage(undefined);
        setSaveStatus("saving");

        void (async () => {
          await systemSleeper.sleep(900);

          if (saveSequenceRef.current !== currentSaveSequence) {
            return;
          }

          if (normalizedDraftValue.toLowerCase() === "explode") {
            setErrorMessage("Could not update heading.");
            setSaveStatus("idle");
            return;
          }

          setValue(normalizedDraftValue);
          setSaveStatus("saved");
          await systemSleeper.sleep(500);

          if (saveSequenceRef.current !== currentSaveSequence) {
            return;
          }

          setSaveStatus("idle");
          setIsEditing(false);
        })();
      }}
      onDraftValueChange={(nextValue) => {
        setDraftValue(nextValue);
        if (errorMessage !== undefined) {
          setErrorMessage(undefined);
        }
      }}
      onEditStart={() => {
        setIsEditing(true);
        setErrorMessage(undefined);
        setSaveStatus(input.saveStatus ?? "idle");
      }}
      placeholder={input.placeholder}
      saveDisabled={saveStatus === "saving"}
      value={value}
    />
  );
}

const meta = {
  title: "Dashboard/Forms/EditableHeading",
  component: StoryHarness,
  decorators: [withDashboardPageWidth],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof StoryHarness>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    value: "Repo Maintainer",
    ariaLabel: "Profile name",
    editButtonLabel: "Edit profile name",
  },
};

export const Saving: Story = {
  args: {
    value: "GitHub pushes to repo triage",
    ariaLabel: "Automation name",
    editButtonLabel: "Edit automation name",
    initiallyEditing: true,
    inputClassName: "text-base font-medium",
    maxWidthClassName: "max-w-4xl",
    placeholder: "Automation name",
    saveStatus: "saving",
  },
};

export const SectionHeading: Story = {
  args: {
    value: "Connection overview",
    ariaLabel: "Section heading",
    editButtonLabel: "Edit section heading",
    headingClassName: "text-base font-medium leading-none",
    headingTag: "h2",
    inputClassName: "text-base font-medium",
  },
};

export const WithError: Story = {
  args: {
    value: "",
    ariaLabel: "Automation name",
    editButtonLabel: "Edit automation name",
    errorMessage: "Automation name is required.",
    initiallyEditing: true,
    inputClassName: "text-base font-medium",
    maxWidthClassName: "max-w-4xl",
    placeholder: "Automation name",
  },
};
