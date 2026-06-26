import { Field, FieldContent, FieldHeader, FieldLabel, Input } from "@mistle/ui";
import { useMemo, type ReactNode } from "react";

import { SingleSelectStringComboboxField } from "../forms/single-select-string-combobox-field.js";
import { FormPageSection } from "../shared/form-page.js";
import {
  createTimezoneOptions,
  formatCronExpressionBreakdownDiagram,
  resolveCronExpressionBreakdown,
  resolveScheduleBehaviorDescription,
  type CronExpressionBreakdown,
} from "../shared/schedule-presentation.js";
import { ScheduledTriggerConversationOptions } from "./scheduled-trigger-form-helpers.js";
import { resolveScheduledTriggerFormPresentation } from "./scheduled-trigger-form-state.js";
import type {
  ScheduledTriggerFormOption,
  ScheduledTriggerFormValueKey,
  ScheduledTriggerFormValues,
} from "./scheduled-trigger-form-types.js";
import {
  TriggerFormFieldError,
  TriggerFormSelectField,
  TriggerFormShell,
} from "./trigger-form-shell.js";

type ScheduledTriggerFormProps = {
  mode: "create" | "edit";
  values: ScheduledTriggerFormValues;
  sandboxProfileOptions: readonly ScheduledTriggerFormOption[];
  primaryRepositoryOptions?: readonly ScheduledTriggerFormOption[];
  fieldErrors: Partial<Record<ScheduledTriggerFormValueKey, string>>;
  validationSummaryError: string | null;
  formError: string | null;
  isSaving: boolean;
  isDeleting: boolean;
  isDuplicating: boolean;
  triggerTypeField?: ReactNode;
  onValueChange: (key: ScheduledTriggerFormValueKey, value: string | boolean) => void;
  onSubmit: () => void;
  onDuplicate: (() => void) | null;
  onDelete: (() => void) | null;
  onViewActivity?: (() => void) | null;
};

type ScheduledTriggerTypeSpecificSectionProps = {
  values: Pick<ScheduledTriggerFormValues, "conversationMode" | "cronExpression" | "timezone">;
  fieldErrors: Pick<
    ScheduledTriggerFormProps["fieldErrors"],
    "conversationMode" | "cronExpression" | "timezone"
  >;
  disabled: boolean;
  onValueChange: (key: "conversationMode" | "cronExpression" | "timezone", value: string) => void;
};

function CronExpressionBreakdownList(input: {
  breakdown: CronExpressionBreakdown | null;
  message: string;
}): React.JSX.Element {
  return (
    <div className="rounded-md border bg-muted/30 p-3 text-sm" aria-label="Cron breakdown">
      {input.breakdown === null ? (
        <p className="text-muted-foreground">{input.message}</p>
      ) : (
        <pre className="overflow-x-auto rounded-sm bg-background p-2 font-mono text-xs leading-5 text-muted-foreground">
          {formatCronExpressionBreakdownDiagram(input.breakdown)}
        </pre>
      )}
    </div>
  );
}

export function ScheduledTriggerTypeSpecificSection(
  input: ScheduledTriggerTypeSpecificSectionProps,
): React.JSX.Element {
  const previewAfter = useMemo(() => new Date(), []);
  const timezoneOptions = useMemo(
    () => createTimezoneOptions(input.values.timezone),
    [input.values.timezone],
  );
  const scheduleBehaviorDescription = resolveScheduleBehaviorDescription({
    after: previewAfter,
    cronExpression: input.values.cronExpression,
    occurrenceLabel: "run",
    previewPrompt: "Enter a valid cron expression and timezone to preview the schedule.",
    timezone: input.values.timezone,
  });
  const cronExpressionBreakdown = resolveCronExpressionBreakdown(input.values.cronExpression);

  return (
    <FormPageSection
      header={
        <div className="space-y-1">
          <h2 className="text-base font-semibold">When this runs</h2>
        </div>
      }
    >
      <div className="p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldHeader>
              <FieldLabel htmlFor="scheduled-trigger-cron-expression">Cron expression</FieldLabel>
            </FieldHeader>
            <FieldContent>
              <Input
                aria-invalid={input.fieldErrors.cronExpression !== undefined ? true : undefined}
                disabled={input.disabled}
                id="scheduled-trigger-cron-expression"
                onChange={(event) => {
                  input.onValueChange("cronExpression", event.currentTarget.value);
                }}
                placeholder="0 9 * * 1"
                value={input.values.cronExpression}
              />
              <TriggerFormFieldError message={input.fieldErrors.cronExpression} />
            </FieldContent>
          </Field>
          <Field>
            <FieldHeader>
              <FieldLabel htmlFor="scheduled-trigger-timezone">Timezone</FieldLabel>
            </FieldHeader>
            <FieldContent>
              <SingleSelectStringComboboxField
                contentClassName="max-h-80"
                disabled={input.disabled}
                emptyMessage="No matching timezones."
                inputId="scheduled-trigger-timezone"
                inputLabel="Timezone"
                invalid={input.fieldErrors.timezone !== undefined}
                onChange={(value) => {
                  input.onValueChange("timezone", value ?? "");
                }}
                options={timezoneOptions}
                placeholder="Asia/Singapore"
                value={input.values.timezone}
              />
              <TriggerFormFieldError message={input.fieldErrors.timezone} />
            </FieldContent>
          </Field>
        </div>

        <div className="mt-4">
          <CronExpressionBreakdownList
            breakdown={cronExpressionBreakdown}
            message={scheduleBehaviorDescription}
          />
        </div>

        <div className="mt-4">
          <TriggerFormSelectField
            disabled={input.disabled}
            error={input.fieldErrors.conversationMode}
            label="Group runs by"
            onValueChange={(value) => {
              input.onValueChange("conversationMode", value);
            }}
            options={ScheduledTriggerConversationOptions}
            placeholder="Select run grouping"
            value={input.values.conversationMode}
          />
        </div>
      </div>
    </FormPageSection>
  );
}

export function ScheduledTriggerForm(input: ScheduledTriggerFormProps): React.JSX.Element {
  const inputTemplateLabelId = "scheduled-trigger-input-template-label";
  const presentation = resolveScheduledTriggerFormPresentation({
    mode: input.mode,
    values: input.values,
    primaryRepositoryOptions: input.primaryRepositoryOptions,
  });
  const disabled = input.isDeleting || input.isSaving || input.isDuplicating;

  return (
    <TriggerFormShell
      enabled={input.values.enabled}
      {...(input.triggerTypeField === undefined
        ? {}
        : { triggerTypeField: input.triggerTypeField })}
      fieldErrors={input.fieldErrors}
      formError={input.formError}
      inputIdPrefix="scheduled-trigger"
      inputTemplate={input.values.inputTemplate}
      inputTemplateDescription="Sent to the agent each time this trigger runs."
      inputTemplateLabelId={inputTemplateLabelId}
      inputTemplateTokens={[]}
      isDeleting={input.isDeleting}
      isDuplicating={input.isDuplicating}
      isSaving={input.isSaving}
      mode={input.mode}
      name={input.values.name}
      onDelete={input.onDelete}
      onDuplicate={input.onDuplicate}
      onSubmit={input.onSubmit}
      onViewActivity={input.onViewActivity ?? null}
      onValueChange={(key, value) => {
        input.onValueChange(key, value);
      }}
      primaryRepositoryId={input.values.primaryRepositoryId}
      {...(input.primaryRepositoryOptions === undefined
        ? {}
        : { primaryRepositoryOptions: input.primaryRepositoryOptions })}
      sandboxProfileId={input.values.sandboxProfileId}
      sandboxProfileOptions={input.sandboxProfileOptions}
      selectedPrimaryRepositoryPath={presentation.selectedPrimaryRepositoryPath}
      selectedWorkspaceRoot={presentation.selectedWorkspaceRoot}
      shouldShowTriggerEnabledField={presentation.shouldShowTriggerEnabledField}
      shouldShowCreateNameField={presentation.shouldShowCreateNameField}
      shouldShowPrimaryRepositoryField={presentation.shouldShowPrimaryRepositoryField}
      submitLabel={presentation.submitLabel}
      validationSummaryError={input.validationSummaryError}
      typeSpecificSection={
        <ScheduledTriggerTypeSpecificSection
          disabled={disabled}
          fieldErrors={input.fieldErrors}
          onValueChange={(key, value) => {
            input.onValueChange(key, value);
          }}
          values={input.values}
        />
      }
    />
  );
}

export type {
  ScheduledTriggerFormOption,
  ScheduledTriggerFormValueKey,
  ScheduledTriggerFormValues,
} from "./scheduled-trigger-form-types.js";
