import { Field, FieldContent, FieldHeader, FieldLabel, Input } from "@mistle/ui";
import { useMemo, type ReactNode } from "react";

import { SingleSelectStringComboboxField } from "../forms/single-select-string-combobox-field.js";
import {
  createTimezoneOptions,
  formatCronExpressionBreakdownDiagram,
  resolveCronExpressionBreakdown,
  resolveSnapshotRefreshScheduleBehaviorDescription,
  type CronExpressionBreakdown,
} from "../pages/sandbox-profile-editor-page-model.js";
import { FormPageSection } from "../shared/form-page.js";
import {
  AutomationFormFieldError,
  AutomationFormSelectField,
  AutomationFormShell,
} from "./automation-form-shell.js";
import { ScheduledAutomationConversationOptions } from "./scheduled-automation-form-helpers.js";
import { resolveScheduledAutomationFormPresentation } from "./scheduled-automation-form-state.js";
import type {
  ScheduledAutomationFormOption,
  ScheduledAutomationFormValueKey,
  ScheduledAutomationFormValues,
} from "./scheduled-automation-form-types.js";

type ScheduledAutomationFormProps = {
  mode: "create" | "edit";
  values: ScheduledAutomationFormValues;
  sandboxProfileOptions: readonly ScheduledAutomationFormOption[];
  primaryRepositoryOptions?: readonly ScheduledAutomationFormOption[];
  fieldErrors: Partial<Record<ScheduledAutomationFormValueKey, string>>;
  validationSummaryError: string | null;
  formError: string | null;
  isSaving: boolean;
  isDeleting: boolean;
  automationTypeField?: ReactNode;
  onValueChange: (key: ScheduledAutomationFormValueKey, value: string | boolean) => void;
  onSubmit: () => void;
  onDelete: (() => void) | null;
};

type ScheduledAutomationTypeSpecificSectionProps = {
  values: Pick<ScheduledAutomationFormValues, "conversationMode" | "cronExpression" | "timezone">;
  fieldErrors: Pick<
    ScheduledAutomationFormProps["fieldErrors"],
    "conversationMode" | "cronExpression" | "timezone"
  >;
  isSaving: boolean;
  isDeleting: boolean;
  onValueChange: (key: "conversationMode" | "cronExpression" | "timezone", value: string) => void;
};

function shouldRenderInlineFieldError(input: {
  key: ScheduledAutomationFormValueKey;
  message: string | undefined;
}): boolean {
  if (input.message === undefined) {
    return false;
  }

  return input.key !== "name" && input.key !== "sandboxProfileId";
}

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

export function ScheduledAutomationTypeSpecificSection(
  input: ScheduledAutomationTypeSpecificSectionProps,
): React.JSX.Element {
  const previewAfter = useMemo(() => new Date(), []);
  const timezoneOptions = useMemo(
    () => createTimezoneOptions(input.values.timezone),
    [input.values.timezone],
  );
  const scheduleBehaviorDescription = resolveSnapshotRefreshScheduleBehaviorDescription({
    after: previewAfter,
    cronExpression: input.values.cronExpression,
    timezone: input.values.timezone,
  });
  const cronExpressionBreakdown = resolveCronExpressionBreakdown(input.values.cronExpression);
  const disabled = input.isDeleting || input.isSaving;

  return (
    <FormPageSection
      header={
        <div className="space-y-1">
          <h2 className="text-base font-semibold">Schedule</h2>
        </div>
      }
    >
      <div className="p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldHeader>
              <FieldLabel htmlFor="scheduled-automation-cron-expression">
                Cron expression
              </FieldLabel>
            </FieldHeader>
            <FieldContent>
              <Input
                aria-invalid={input.fieldErrors.cronExpression !== undefined ? true : undefined}
                disabled={disabled}
                id="scheduled-automation-cron-expression"
                onChange={(event) => {
                  input.onValueChange("cronExpression", event.currentTarget.value);
                }}
                placeholder="0 9 * * 1"
                value={input.values.cronExpression}
              />
              <AutomationFormFieldError
                message={
                  shouldRenderInlineFieldError({
                    key: "cronExpression",
                    message: input.fieldErrors.cronExpression,
                  })
                    ? input.fieldErrors.cronExpression
                    : undefined
                }
              />
            </FieldContent>
          </Field>
          <Field>
            <FieldHeader>
              <FieldLabel htmlFor="scheduled-automation-timezone">Timezone</FieldLabel>
            </FieldHeader>
            <FieldContent>
              <SingleSelectStringComboboxField
                contentClassName="max-h-80"
                disabled={disabled}
                emptyMessage="No matching timezones."
                inputId="scheduled-automation-timezone"
                inputLabel="Timezone"
                invalid={input.fieldErrors.timezone !== undefined}
                onChange={(value) => {
                  input.onValueChange("timezone", value ?? "");
                }}
                options={timezoneOptions}
                placeholder="Asia/Singapore"
                value={input.values.timezone}
              />
              <AutomationFormFieldError
                message={
                  shouldRenderInlineFieldError({
                    key: "timezone",
                    message: input.fieldErrors.timezone,
                  })
                    ? input.fieldErrors.timezone
                    : undefined
                }
              />
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
          <AutomationFormSelectField
            disabled={disabled}
            error={input.fieldErrors.conversationMode}
            label="Group runs by"
            onValueChange={(value) => {
              input.onValueChange("conversationMode", value);
            }}
            options={ScheduledAutomationConversationOptions}
            placeholder="Select run grouping"
            value={input.values.conversationMode}
          />
        </div>
      </div>
    </FormPageSection>
  );
}

export function ScheduledAutomationForm(input: ScheduledAutomationFormProps): React.JSX.Element {
  const inputTemplateLabelId = "scheduled-automation-input-template-label";
  const presentation = resolveScheduledAutomationFormPresentation({
    mode: input.mode,
    values: input.values,
    primaryRepositoryOptions: input.primaryRepositoryOptions,
  });

  return (
    <AutomationFormShell
      enabled={input.values.enabled}
      {...(input.automationTypeField === undefined
        ? {}
        : { automationTypeField: input.automationTypeField })}
      fieldErrors={input.fieldErrors}
      formError={input.formError}
      inputIdPrefix="scheduled-automation"
      inputTemplate={input.values.inputTemplate}
      inputTemplateDescription="Sent to the agent each time the automation runs."
      inputTemplateLabelId={inputTemplateLabelId}
      inputTemplateTokens={[]}
      isDeleting={input.isDeleting}
      isSaving={input.isSaving}
      mode={input.mode}
      name={input.values.name}
      onDelete={input.onDelete}
      onSubmit={input.onSubmit}
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
      shouldShowAutomationEnabledField={presentation.shouldShowAutomationEnabledField}
      shouldShowCreateNameField={presentation.shouldShowCreateNameField}
      shouldShowPrimaryRepositoryField={presentation.shouldShowPrimaryRepositoryField}
      submitLabel={presentation.submitLabel}
      validationSummaryError={input.validationSummaryError}
      typeSpecificSection={
        <ScheduledAutomationTypeSpecificSection
          fieldErrors={input.fieldErrors}
          isDeleting={input.isDeleting}
          isSaving={input.isSaving}
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
  ScheduledAutomationFormOption,
  ScheduledAutomationFormValueKey,
  ScheduledAutomationFormValues,
} from "./scheduled-automation-form-types.js";
