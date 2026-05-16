import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import { PageFrame } from "../shared/page-frame.js";
import { validateScheduledTriggerFormValues } from "./scheduled-trigger-form-helpers.js";
import { ScheduledTriggerConversationModes } from "./scheduled-trigger-form-types.js";
import {
  ScheduledTriggerForm,
  type ScheduledTriggerFormOption,
  type ScheduledTriggerFormValueKey,
  type ScheduledTriggerFormValues,
} from "./scheduled-trigger-form.js";
import { TriggerTypeDisplayField, TriggerTypeSelectField } from "./trigger-type-field.js";

const SandboxProfileOptions: readonly ScheduledTriggerFormOption[] = [
  {
    value: "sbp_repo_maintainer",
    label: "Repo Maintainer",
  },
  {
    value: "sbp_finance_investigator",
    label: "Finance Investigator",
  },
];

const PrimaryRepositoryOptions: readonly ScheduledTriggerFormOption[] = [
  {
    value: "__workspace_root__",
    label: "None",
    path: "workspace root",
  },
  {
    value: "mistlehq/platform",
    label: "mistlehq/platform",
    path: "/root/mistlehq/platform",
  },
  {
    value: "mistlehq/dashboard",
    label: "mistlehq/dashboard",
    path: "/root/mistlehq/dashboard",
  },
];

const EmptyCreateValues: ScheduledTriggerFormValues = {
  name: "",
  sandboxProfileId: "",
  primaryRepositoryId: "",
  enabled: true,
  cronExpression: "0 9 * * *",
  timezone: "Asia/Singapore",
  conversationMode: ScheduledTriggerConversationModes.SAME,
  inputTemplate: "",
};

export const ExistingScheduledTriggerValues: ScheduledTriggerFormValues = {
  name: "Daily repository triage",
  sandboxProfileId: "sbp_repo_maintainer",
  primaryRepositoryId: "mistlehq/platform",
  enabled: true,
  cronExpression: "0 9 * * 1-5",
  timezone: "Asia/Singapore",
  conversationMode: ScheduledTriggerConversationModes.SAME,
  inputTemplate: "Review open pull requests and summarize anything blocked.",
};

export function ScheduledTriggerFormStoryHarness(input: {
  mode: "create" | "edit";
  values: ScheduledTriggerFormValues;
  fieldErrors?: Partial<Record<ScheduledTriggerFormValueKey, string>>;
  validationSummaryError?: string | null;
  formError?: string | null;
  isSaving?: boolean;
  isDeleting?: boolean;
  onDelete?: (() => void) | null;
  primaryRepositoryOptions?: readonly ScheduledTriggerFormOption[];
  sandboxProfileOptions?: readonly ScheduledTriggerFormOption[];
  enableSubmitValidation?: boolean;
}): React.JSX.Element {
  const [values, setValues] = useState(input.values);
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<ScheduledTriggerFormValueKey, string>>
  >({
    ...(input.fieldErrors ?? {}),
  });
  const [validationSummaryError, setValidationSummaryError] = useState<string | null>(
    input.validationSummaryError ?? null,
  );
  const pageTitle = input.mode === "create" ? "Create trigger" : "";

  return (
    <PageFrame title={pageTitle} width="form">
      <ScheduledTriggerForm
        fieldErrors={fieldErrors}
        formError={input.formError ?? null}
        validationSummaryError={validationSummaryError}
        isDeleting={input.isDeleting ?? false}
        isSaving={input.isSaving ?? false}
        triggerTypeField={
          input.mode === "create" ? (
            <TriggerTypeSelectField value="scheduled" />
          ) : (
            <TriggerTypeDisplayField value="scheduled" />
          )
        }
        mode={input.mode}
        onDelete={input.onDelete ?? null}
        onSubmit={() => {
          if (input.enableSubmitValidation !== true) {
            return;
          }

          const nextFieldErrors = validateScheduledTriggerFormValues(values);
          setFieldErrors(nextFieldErrors);
          setValidationSummaryError(
            Object.keys(nextFieldErrors).length > 0
              ? "Please address the fields highlighted in red."
              : null,
          );
        }}
        onValueChange={(key, value) => {
          setValues((currentValues) => ({
            ...currentValues,
            [key]: value,
          }));
          if (input.enableSubmitValidation === true) {
            setFieldErrors({});
            setValidationSummaryError(null);
          }
        }}
        {...(input.primaryRepositoryOptions === undefined
          ? {}
          : { primaryRepositoryOptions: input.primaryRepositoryOptions })}
        sandboxProfileOptions={input.sandboxProfileOptions ?? SandboxProfileOptions}
        values={values}
      />
    </PageFrame>
  );
}

const meta = {
  title: "Dashboard/Triggers/Schedule/Form",
  component: ScheduledTriggerFormStoryHarness,
  decorators: [withDashboardPageStory],
  excludeStories: ["ExistingScheduledTriggerValues", "ScheduledTriggerFormStoryHarness"],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof ScheduledTriggerFormStoryHarness>;

export default meta;

type Story = StoryObj<typeof meta>;

export const CreatePageLayout: Story = {
  args: {
    mode: "create",
    values: EmptyCreateValues,
  },
};

export const EditPageLayout: Story = {
  args: {
    mode: "edit",
    onDelete: function onDelete() {},
    primaryRepositoryOptions: PrimaryRepositoryOptions,
    values: ExistingScheduledTriggerValues,
  },
};

export const WithPrimaryRepositorySelection: Story = {
  args: {
    mode: "create",
    primaryRepositoryOptions: PrimaryRepositoryOptions,
    values: {
      ...EmptyCreateValues,
      sandboxProfileId: "sbp_repo_maintainer",
      primaryRepositoryId: "mistlehq/platform",
    },
  },
};

export const NewConversationEachRun: Story = {
  args: {
    mode: "create",
    primaryRepositoryOptions: PrimaryRepositoryOptions,
    values: {
      ...ExistingScheduledTriggerValues,
      conversationMode: ScheduledTriggerConversationModes.NEW_EACH_RUN,
    },
  },
};

export const InvalidCronPreview: Story = {
  args: {
    mode: "create",
    values: {
      ...EmptyCreateValues,
      cronExpression: "not a cron expression",
    },
  },
};

export const ValidationErrors: Story = {
  args: {
    mode: "create",
    validationSummaryError: "Please address the fields highlighted in red.",
    fieldErrors: {
      name: "Trigger name is required.",
      sandboxProfileId: "Select a sandbox profile.",
      cronExpression: "Cron expression is required.",
      timezone: "Timezone is required.",
      inputTemplate: "User message is required.",
    },
    values: {
      ...EmptyCreateValues,
      cronExpression: "",
      timezone: "",
    },
  },
};

export const Saving: Story = {
  args: {
    mode: "edit",
    isDeleting: false,
    isSaving: true,
    onDelete: function onDelete() {},
    primaryRepositoryOptions: PrimaryRepositoryOptions,
    values: ExistingScheduledTriggerValues,
  },
};
