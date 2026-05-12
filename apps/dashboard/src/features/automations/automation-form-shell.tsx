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
import type { ReactNode } from "react";

import { SingleSelectStringComboboxField } from "../forms/single-select-string-combobox-field.js";
import { FormPageFooter, FormPageSection, FormPageStack } from "../shared/form-page.js";
import { AgentInstructionsEditor } from "./agent-instructions-editor.js";
import type { AgentInstructionsEditorToken } from "./agent-instructions-token-catalog.js";
import { WebhookAutomationTitleEditor } from "./webhook-automation-title-editor.js";

export type AutomationFormShellOption = {
  value: string;
  label: string;
  description?: string;
  path?: string;
};

type CommonAutomationFormValueKey =
  | "enabled"
  | "inputTemplate"
  | "name"
  | "primaryRepositoryId"
  | "sandboxProfileId";

type AutomationFormShellProps = {
  mode: "create" | "edit";
  name: string;
  enabled: boolean;
  sandboxProfileId: string;
  primaryRepositoryId: string;
  inputTemplate: string;
  sandboxProfileOptions: readonly AutomationFormShellOption[];
  sandboxProfileStatusMessage?: AutomationFormShellStatusMessage | undefined;
  primaryRepositoryOptions?: readonly AutomationFormShellOption[];
  fieldErrors: Partial<Record<CommonAutomationFormValueKey, string>>;
  validationSummaryError: string | null;
  formError: string | null;
  isSaving: boolean;
  isDeleting: boolean;
  automationTypeField?: ReactNode;
  typeSpecificSection: ReactNode;
  extraSectionsBeforeMessage?: ReactNode;
  shouldShowMessageSection?: boolean;
  inputTemplateLabelId: string;
  inputTemplateDescription: ReactNode;
  inputTemplatePlaceholderText?: string;
  inputTemplateTokens: readonly AgentInstructionsEditorToken[];
  submitLabel: string;
  shouldShowAutomationEnabledField: boolean;
  shouldShowCreateNameField: boolean;
  shouldShowPrimaryRepositoryField: boolean;
  selectedPrimaryRepositoryPath: string | null;
  selectedWorkspaceRoot: boolean;
  inputIdPrefix: string;
  onValueChange: (key: CommonAutomationFormValueKey, value: string | boolean) => void;
  onSubmit: () => void;
  onDelete: (() => void) | null;
};

export type AutomationFormShellStatusMessage = {
  message: string;
  variant: "alert" | "default";
};

function shouldRenderCommonAutomationInlineFieldError(input: {
  key: CommonAutomationFormValueKey;
  message: string | undefined;
}): boolean {
  if (input.message === undefined) {
    return false;
  }

  return input.key !== "name" && input.key !== "sandboxProfileId";
}

export function AutomationFormFieldError(input: {
  message: string | undefined;
  className?: string;
}): React.JSX.Element | null {
  if (input.message === undefined) {
    return null;
  }

  return <p className={cn("text-destructive text-sm", input.className)}>{input.message}</p>;
}

export function AutomationFormSelectField(input: {
  label: string;
  value: string;
  placeholder: string;
  options: readonly AutomationFormShellOption[];
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
        <AutomationFormFieldError
          message={input.showInlineError === false ? undefined : input.error}
        />
      </FieldContent>
    </Field>
  );
}

export function AutomationFormShell(input: AutomationFormShellProps): React.JSX.Element {
  const disabled = input.isDeleting || input.isSaving;
  const automationEnabledId = `${input.inputIdPrefix}-enabled`;
  const automationNameId = `${input.inputIdPrefix}-name`;
  const primaryRepositoryInputId = `${input.inputIdPrefix}-primary-repository-combobox`;
  const automationNameField = input.shouldShowCreateNameField ? (
    <div className="p-4">
      <Field orientation="horizontal">
        <FieldHeader>
          <FieldLabel htmlFor={automationNameId}>Automation name</FieldLabel>
        </FieldHeader>
        <FieldContent>
          <Input
            aria-invalid={input.fieldErrors.name !== undefined ? true : undefined}
            disabled={disabled}
            id={automationNameId}
            onChange={(event) => {
              input.onValueChange("name", event.currentTarget.value);
            }}
            value={input.name}
          />
          <AutomationFormFieldError
            message={
              shouldRenderCommonAutomationInlineFieldError({
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
  ) : null;
  const automationTypeField =
    input.automationTypeField === undefined ? null : (
      <div className="p-4">{input.automationTypeField}</div>
    );
  const sandboxProfileFieldError = input.fieldErrors.sandboxProfileId;
  const sandboxProfileField = (
    <div className="p-4">
      <AutomationFormSelectField
        disabled={disabled}
        error={sandboxProfileFieldError}
        label="Sandbox profile"
        orientation="horizontal"
        onValueChange={(value) => {
          input.onValueChange("sandboxProfileId", value);
        }}
        options={input.sandboxProfileOptions}
        placeholder="Select profile"
        showInlineError={false}
        value={input.sandboxProfileId}
      />
    </div>
  );

  return (
    <FormPageStack>
      {input.mode === "edit" ? (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <WebhookAutomationTitleEditor
              errorMessage={
                shouldRenderCommonAutomationInlineFieldError({
                  key: "name",
                  message: input.fieldErrors.name,
                })
                  ? input.fieldErrors.name
                  : undefined
              }
              onCommit={(nextValue) => {
                input.onValueChange("name", nextValue);
              }}
              disabled={disabled}
              title={input.name}
            />
          </div>

          {input.onDelete === null ? null : (
            <Button
              aria-label="Delete automation"
              disabled={disabled}
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

      {input.sandboxProfileStatusMessage === undefined ? null : (
        <Notice variant={input.sandboxProfileStatusMessage.variant}>
          {input.sandboxProfileStatusMessage.message}
        </Notice>
      )}

      <FormPageSection>
        {input.shouldShowAutomationEnabledField ? (
          <div className="border-b px-4 py-4">
            <div className="flex min-h-10 items-center justify-between gap-3">
              <div className="space-y-1">
                <FieldLabel htmlFor={automationEnabledId}>Automation enabled</FieldLabel>
              </div>
              <Switch
                aria-label="Automation enabled"
                checked={input.enabled}
                disabled={disabled}
                id={automationEnabledId}
                onCheckedChange={(checked) => {
                  input.onValueChange("enabled", checked);
                }}
              />
            </div>
          </div>
        ) : null}

        {input.mode === "create" ? (
          <>
            {sandboxProfileField}
            {automationTypeField}
            {automationNameField}
          </>
        ) : (
          <>
            {automationNameField}
            {automationTypeField}
            {sandboxProfileField}
          </>
        )}

        {input.shouldShowPrimaryRepositoryField ? (
          <div className="border-t p-4">
            <Field contentWidth="fill" orientation="horizontal">
              <FieldHeader>
                <FieldLabel htmlFor={primaryRepositoryInputId}>Primary repository</FieldLabel>
              </FieldHeader>
              <FieldContent>
                <SingleSelectStringComboboxField
                  disabled={disabled}
                  emptyMessage="No matching repositories."
                  inputId={primaryRepositoryInputId}
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
                    input.primaryRepositoryId.trim().length === 0
                      ? undefined
                      : input.primaryRepositoryId
                  }
                />
                {input.selectedPrimaryRepositoryPath === null ? null : (
                  <div className="text-muted-foreground mt-2 flex flex-col gap-1 text-sm">
                    <p>
                      {input.selectedWorkspaceRoot ? (
                        "The agent will start its session at the workspace root."
                      ) : (
                        <>
                          The agent will start its session in{" "}
                          <span className="font-mono text-foreground">
                            {input.selectedPrimaryRepositoryPath}
                          </span>
                          .
                        </>
                      )}
                    </p>
                  </div>
                )}
                <AutomationFormFieldError message={input.fieldErrors.primaryRepositoryId} />
              </FieldContent>
            </Field>
          </div>
        ) : null}
      </FormPageSection>

      {input.typeSpecificSection}
      {input.extraSectionsBeforeMessage}

      {input.shouldShowMessageSection === false ? null : (
        <FormPageSection>
          <div className="p-4">
            <Field>
              <FieldHeader>
                <div className="space-y-1">
                  <FieldLabel id={input.inputTemplateLabelId}>User message</FieldLabel>
                  <FieldDescription>{input.inputTemplateDescription}</FieldDescription>
                </div>
              </FieldHeader>
              <FieldContent>
                <AgentInstructionsEditor
                  ariaLabelledBy={input.inputTemplateLabelId}
                  disabled={disabled}
                  invalid={input.fieldErrors.inputTemplate !== undefined}
                  onChange={(nextValue) => {
                    input.onValueChange("inputTemplate", nextValue);
                  }}
                  {...(input.inputTemplatePlaceholderText === undefined
                    ? {}
                    : { placeholderText: input.inputTemplatePlaceholderText })}
                  tokens={input.inputTemplateTokens}
                  value={input.inputTemplate}
                />
                <AutomationFormFieldError
                  message={
                    shouldRenderCommonAutomationInlineFieldError({
                      key: "inputTemplate",
                      message: input.fieldErrors.inputTemplate,
                    })
                      ? input.fieldErrors.inputTemplate
                      : undefined
                  }
                  className="text-right text-xs"
                />
              </FieldContent>
            </Field>
          </div>
        </FormPageSection>
      )}

      <FormPageFooter>
        {input.validationSummaryError === null ? null : (
          <Notice appearance="subtle" variant="alert">
            {input.validationSummaryError}
          </Notice>
        )}
        <Button disabled={disabled} onClick={input.onSubmit} type="button">
          {input.isSaving ? "Saving..." : input.submitLabel}
        </Button>
      </FormPageFooter>
    </FormPageStack>
  );
}
