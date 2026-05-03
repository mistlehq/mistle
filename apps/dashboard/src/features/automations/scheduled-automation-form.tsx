import {
  Button,
  Field,
  FieldContent,
  FieldDescription,
  FieldHeader,
  FieldLabel,
  Input,
  Notice,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  cn,
} from "@mistle/ui";
import { TrashIcon } from "@phosphor-icons/react";
import { useMemo, type ReactNode } from "react";

import { SingleSelectStringComboboxField } from "../forms/single-select-string-combobox-field.js";
import {
  createTimezoneOptions,
  formatCronExpressionBreakdownDiagram,
  resolveCronExpressionBreakdown,
  resolveSnapshotRefreshScheduleBehaviorDescription,
  type CronExpressionBreakdown,
} from "../pages/sandbox-profile-editor-page-model.js";
import { FormPageFooter, FormPageSection, FormPageStack } from "../shared/form-page.js";
import { AgentInstructionsEditor } from "./agent-instructions-editor.js";
import { ScheduledAutomationConversationOptions } from "./scheduled-automation-form-helpers.js";
import { resolveScheduledAutomationFormPresentation } from "./scheduled-automation-form-state.js";
import type {
  ScheduledAutomationFormOption,
  ScheduledAutomationFormValueKey,
  ScheduledAutomationFormValues,
} from "./scheduled-automation-form-types.js";
import { WebhookAutomationTitleEditor } from "./webhook-automation-title-editor.js";

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

function shouldRenderInlineFieldError(input: {
  key: ScheduledAutomationFormValueKey;
  message: string | undefined;
}): boolean {
  if (input.message === undefined) {
    return false;
  }

  return input.key !== "name" && input.key !== "sandboxProfileId";
}

function FieldError(input: {
  message: string | undefined;
  className?: string;
}): React.JSX.Element | null {
  if (input.message === undefined) {
    return null;
  }

  return <p className={cn("text-destructive text-sm", input.className)}>{input.message}</p>;
}

function SelectField(input: {
  label: string;
  value: string;
  placeholder: string;
  options: readonly ScheduledAutomationFormOption[];
  error: string | undefined;
  showInlineError?: boolean;
  orientation?: "vertical" | "horizontal";
  disabled?: boolean;
  onValueChange: (value: string) => void;
}): React.JSX.Element {
  const selectedOption = input.options.find((option) => option.value === input.value);
  const isInvalid = input.error !== undefined;

  return (
    <Field orientation={input.orientation ?? "vertical"}>
      <FieldLabel>{input.label}</FieldLabel>
      <FieldContent>
        <Select
          disabled={input.disabled}
          onValueChange={(value) => {
            if (value === null) {
              return;
            }

            input.onValueChange(value);
          }}
          value={input.value}
        >
          <SelectTrigger
            aria-invalid={isInvalid ? true : undefined}
            className={input.orientation === "horizontal" ? undefined : "w-full"}
          >
            <SelectValue placeholder={input.placeholder}>{selectedOption?.label}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {input.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                <div className="flex flex-col gap-0.5">
                  <span>{option.label}</span>
                  {option.description === undefined ? null : (
                    <span className="text-muted-foreground text-xs">{option.description}</span>
                  )}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldError message={input.showInlineError === false ? undefined : input.error} />
      </FieldContent>
    </Field>
  );
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

export function ScheduledAutomationForm(input: ScheduledAutomationFormProps): React.JSX.Element {
  const inputTemplateLabelId = "scheduled-automation-input-template-label";
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
  const presentation = resolveScheduledAutomationFormPresentation({
    mode: input.mode,
    values: input.values,
    primaryRepositoryOptions: input.primaryRepositoryOptions,
  });

  return (
    <FormPageStack>
      {input.mode === "edit" ? (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <WebhookAutomationTitleEditor
              errorMessage={
                shouldRenderInlineFieldError({
                  key: "name",
                  message: input.fieldErrors.name,
                })
                  ? input.fieldErrors.name
                  : undefined
              }
              onCommit={(nextValue) => {
                input.onValueChange("name", nextValue);
              }}
              disabled={input.isDeleting || input.isSaving}
              title={input.values.name}
            />
          </div>

          {input.onDelete === null ? null : (
            <Button
              aria-label="Delete automation"
              disabled={input.isDeleting || input.isSaving}
              onClick={input.onDelete}
              size="icon-sm"
              type="button"
              variant="outline"
            >
              <TrashIcon aria-hidden className="size-4" />
            </Button>
          )}
        </div>
      ) : null}

      {input.formError === null ? null : (
        <Notice title="Automation could not be saved" variant="alert">
          {input.formError}
        </Notice>
      )}

      <FormPageSection>
        {presentation.shouldShowAutomationEnabledField ? (
          <div className="border-b px-4 py-4">
            <div className="flex min-h-10 items-center justify-between gap-3">
              <div className="space-y-1">
                <FieldLabel htmlFor="scheduled-automation-enabled">Automation enabled</FieldLabel>
              </div>
              <Switch
                aria-label="Automation enabled"
                checked={input.values.enabled}
                disabled={input.isDeleting || input.isSaving}
                id="scheduled-automation-enabled"
                onCheckedChange={(checked) => {
                  input.onValueChange("enabled", checked);
                }}
              />
            </div>
          </div>
        ) : null}

        {presentation.shouldShowCreateNameField ? (
          <div className="p-4">
            <Field orientation="horizontal">
              <FieldHeader>
                <FieldLabel htmlFor="scheduled-automation-name">Automation name</FieldLabel>
              </FieldHeader>
              <FieldContent>
                <Input
                  aria-invalid={input.fieldErrors.name !== undefined ? true : undefined}
                  disabled={input.isDeleting || input.isSaving}
                  id="scheduled-automation-name"
                  onChange={(event) => {
                    input.onValueChange("name", event.currentTarget.value);
                  }}
                  value={input.values.name}
                />
                <FieldError
                  message={
                    shouldRenderInlineFieldError({
                      key: "name",
                      message: input.fieldErrors.name,
                    })
                      ? input.fieldErrors.name
                      : undefined
                  }
                />
              </FieldContent>
            </Field>
          </div>
        ) : null}
        {input.automationTypeField === undefined ? null : (
          <div className="p-4">{input.automationTypeField}</div>
        )}

        <div className="p-4">
          <SelectField
            disabled={input.isDeleting || input.isSaving}
            error={input.fieldErrors.sandboxProfileId}
            label="Sandbox profile"
            orientation="horizontal"
            onValueChange={(value) => {
              input.onValueChange("sandboxProfileId", value);
            }}
            options={input.sandboxProfileOptions}
            placeholder="Select profile"
            showInlineError={false}
            value={input.values.sandboxProfileId}
          />
        </div>

        {presentation.shouldShowPrimaryRepositoryField ? (
          <div className="border-t p-4">
            <Field contentWidth="fill" orientation="horizontal">
              <FieldHeader>
                <FieldLabel htmlFor="scheduled-automation-primary-repository-combobox">
                  Primary repository
                </FieldLabel>
              </FieldHeader>
              <FieldContent>
                <SingleSelectStringComboboxField
                  disabled={input.isDeleting || input.isSaving}
                  emptyMessage="No matching repositories."
                  inputId="scheduled-automation-primary-repository-combobox"
                  inputLabel="Primary repository"
                  invalid={input.fieldErrors.primaryRepositoryId !== undefined}
                  onChange={(value) => {
                    input.onValueChange("primaryRepositoryId", value ?? "");
                  }}
                  options={
                    input.primaryRepositoryOptions?.map((option) => ({
                      value: option.value,
                      label: option.label,
                    })) ?? []
                  }
                  placeholder="Select a repository"
                  showClear={false}
                  value={
                    input.values.primaryRepositoryId.trim().length === 0
                      ? undefined
                      : input.values.primaryRepositoryId
                  }
                />
                {presentation.selectedPrimaryRepositoryPath === null ? null : (
                  <div className="text-muted-foreground mt-2 flex flex-col gap-1 text-sm">
                    <p>
                      {presentation.selectedWorkspaceRoot ? (
                        "The agent will start its session at the workspace root."
                      ) : (
                        <>
                          The agent will start its session in{" "}
                          <span className="font-mono text-foreground">
                            {presentation.selectedPrimaryRepositoryPath}
                          </span>
                          .
                        </>
                      )}
                    </p>
                  </div>
                )}
                <FieldError message={input.fieldErrors.primaryRepositoryId} />
              </FieldContent>
            </Field>
          </div>
        ) : null}
      </FormPageSection>

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
                  disabled={input.isDeleting || input.isSaving}
                  id="scheduled-automation-cron-expression"
                  onChange={(event) => {
                    input.onValueChange("cronExpression", event.currentTarget.value);
                  }}
                  placeholder="0 9 * * 1"
                  value={input.values.cronExpression}
                />
                <FieldError
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
                  disabled={input.isDeleting || input.isSaving}
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
                <FieldError
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
            <SelectField
              disabled={input.isDeleting || input.isSaving}
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

      <FormPageSection>
        <div className="p-4">
          <Field>
            <FieldHeader>
              <div className="space-y-1">
                <FieldLabel id={inputTemplateLabelId}>User message</FieldLabel>
                <FieldDescription>
                  Sent to the agent each time the automation runs.
                </FieldDescription>
              </div>
            </FieldHeader>
            <FieldContent>
              <AgentInstructionsEditor
                ariaLabelledBy={inputTemplateLabelId}
                disabled={input.isDeleting || input.isSaving}
                invalid={input.fieldErrors.inputTemplate !== undefined}
                onChange={(nextValue) => {
                  input.onValueChange("inputTemplate", nextValue);
                }}
                tokens={[]}
                value={input.values.inputTemplate}
              />
              <FieldError
                className="text-right text-xs"
                message={
                  shouldRenderInlineFieldError({
                    key: "inputTemplate",
                    message: input.fieldErrors.inputTemplate,
                  })
                    ? input.fieldErrors.inputTemplate
                    : undefined
                }
              />
            </FieldContent>
          </Field>
        </div>
      </FormPageSection>

      <FormPageFooter>
        {input.validationSummaryError === null ? null : (
          <Notice appearance="subtle" variant="alert">
            {input.validationSummaryError}
          </Notice>
        )}
        <Button
          disabled={input.isDeleting || input.isSaving}
          onClick={input.onSubmit}
          type="button"
        >
          {input.isSaving ? "Saving..." : presentation.submitLabel}
        </Button>
      </FormPageFooter>
    </FormPageStack>
  );
}

export type {
  ScheduledAutomationFormOption,
  ScheduledAutomationFormValueKey,
  ScheduledAutomationFormValues,
} from "./scheduled-automation-form-types.js";
