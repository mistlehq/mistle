import {
  Button,
  ButtonGroup,
  DropdownMenuItem,
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
  MoreActionsMenu,
  Switch,
  cn,
} from "@mistle/ui";
import { ClockCounterClockwiseIcon, TrashIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

import { SingleSelectStringComboboxField } from "../forms/single-select-string-combobox-field.js";
import { FormPageFooter, FormPageSection, FormPageStack } from "../shared/form-page.js";
import { AgentInstructionsEditor } from "./agent-instructions-editor.js";
import type { AgentInstructionsEditorToken } from "./agent-instructions-token-catalog.js";
import { WebhookTriggerTitleEditor } from "./webhook-trigger-title-editor.js";

export type TriggerFormShellOption = {
  value: string;
  label: string;
  description?: string;
  path?: string;
};

type CommonTriggerFormValueKey =
  | "enabled"
  | "inputTemplate"
  | "name"
  | "primaryRepositoryId"
  | "sandboxProfileId";

type TriggerFormShellProps = {
  mode: "create" | "edit";
  name: string;
  enabled: boolean;
  sandboxProfileId: string;
  primaryRepositoryId: string;
  inputTemplate: string;
  sandboxProfileOptions: readonly TriggerFormShellOption[];
  sandboxProfileStatusMessage?: TriggerFormShellStatusMessage | undefined;
  primaryRepositoryOptions?: readonly TriggerFormShellOption[];
  fieldErrors: Partial<Record<CommonTriggerFormValueKey, string>>;
  validationSummaryError: string | null;
  formError: string | null;
  isSaving: boolean;
  isDeleting: boolean;
  triggerTypeField?: ReactNode;
  typeSpecificSection: ReactNode;
  extraSectionsBeforeMessage?: ReactNode;
  shouldShowMessageSection?: boolean;
  inputTemplateLabelId: string;
  inputTemplateDescription: ReactNode;
  inputTemplatePlaceholderText?: string;
  inputTemplateTokens: readonly AgentInstructionsEditorToken[];
  submitLabel: string;
  shouldShowTriggerEnabledField: boolean;
  shouldShowCreateNameField: boolean;
  shouldShowPrimaryRepositoryField: boolean;
  selectedPrimaryRepositoryPath: string | null;
  selectedWorkspaceRoot: boolean;
  inputIdPrefix: string;
  onValueChange: (key: CommonTriggerFormValueKey, value: string | boolean) => void;
  onSubmit: () => void;
  onDelete: (() => void) | null;
  onViewActivity: (() => void) | null;
};

export type TriggerFormShellStatusMessage = {
  message: string;
  variant: "alert" | "default";
};

export function TriggerFormFieldError(input: {
  message: string | undefined;
  className?: string;
}): React.JSX.Element | null {
  if (input.message === undefined) {
    return null;
  }

  return (
    <div aria-live="polite" data-slot="field-error" role="status">
      <div
        className={cn("flex items-center justify-start text-xs text-destructive", input.className)}
      >
        <span>{input.message}</span>
      </div>
    </div>
  );
}

export function TriggerFormSelectField(input: {
  label: string;
  value: string;
  placeholder: string;
  options: readonly TriggerFormShellOption[];
  error: string | undefined;
  disabled?: boolean;
  onValueChange: (value: string) => void;
}): React.JSX.Element {
  const selectedOption = input.options.find((option) => option.value === input.value);

  return (
    <Field>
      <FieldLabel>{input.label}</FieldLabel>
      <FieldContent>
        <TriggerFormSelectControl
          error={input.error}
          onValueChange={input.onValueChange}
          options={input.options}
          placeholder={input.placeholder}
          selectedLabel={selectedOption?.label}
          value={input.value}
          {...(input.disabled === undefined ? {} : { disabled: input.disabled })}
        />
        <TriggerFormFieldError message={input.error} />
      </FieldContent>
    </Field>
  );
}

function TriggerFormSelectControl(input: {
  value: string;
  placeholder: string;
  selectedLabel: string | undefined;
  options: readonly TriggerFormShellOption[];
  error: string | undefined;
  disabled?: boolean;
  onValueChange: (value: string) => void;
}): React.JSX.Element {
  return (
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
      <SelectTrigger aria-invalid={input.error !== undefined ? true : undefined} className="w-full">
        <SelectValue placeholder={input.placeholder}>{input.selectedLabel}</SelectValue>
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
  );
}

export function TriggerFormShell(input: TriggerFormShellProps): React.JSX.Element {
  const disabled = input.isDeleting || input.isSaving;
  const submitButtonLabel = input.isSaving ? "Saving..." : input.submitLabel;
  const triggerEnabledId = `${input.inputIdPrefix}-enabled`;
  const triggerNameId = `${input.inputIdPrefix}-name`;
  const primaryRepositoryInputId = `${input.inputIdPrefix}-primary-repository-combobox`;
  const triggerNameField = input.shouldShowCreateNameField ? (
    <div className="p-4">
      <Field orientation="horizontal">
        <FieldHeader>
          <FieldLabel htmlFor={triggerNameId}>Trigger name</FieldLabel>
        </FieldHeader>
        <FieldContent>
          <Input
            aria-invalid={input.fieldErrors.name !== undefined ? true : undefined}
            disabled={disabled}
            id={triggerNameId}
            onChange={(event) => {
              input.onValueChange("name", event.currentTarget.value);
            }}
            value={input.name}
          />
          <TriggerFormFieldError message={input.fieldErrors.name} />
        </FieldContent>
      </Field>
    </div>
  ) : null;
  const triggerTypeField =
    input.triggerTypeField === undefined ? null : (
      <div className="p-4">{input.triggerTypeField}</div>
    );
  const sandboxProfileFieldError = input.fieldErrors.sandboxProfileId;
  const selectedSandboxProfileOption = input.sandboxProfileOptions.find(
    (option) => option.value === input.sandboxProfileId,
  );
  const sandboxProfileField = (
    <div className="p-4">
      <Field orientation="horizontal">
        <FieldLabel>Sandbox profile</FieldLabel>
        <FieldContent>
          <div className="flex w-fit max-w-full flex-col gap-1 self-end">
            <TriggerFormSelectControl
              error={sandboxProfileFieldError}
              onValueChange={(value) => {
                input.onValueChange("sandboxProfileId", value);
              }}
              options={input.sandboxProfileOptions}
              placeholder="Select profile"
              selectedLabel={selectedSandboxProfileOption?.label}
              value={input.sandboxProfileId}
              disabled={disabled}
            />
            <TriggerFormFieldError message={sandboxProfileFieldError} />
          </div>
        </FieldContent>
      </Field>
    </div>
  );

  return (
    <FormPageStack>
      {input.mode === "edit" ? (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <WebhookTriggerTitleEditor
              errorMessage={input.fieldErrors.name}
              onCommit={(nextValue) => {
                input.onValueChange("name", nextValue);
              }}
              disabled={disabled}
              title={input.name}
            />
          </div>

          <ButtonGroup aria-label="Trigger actions" className="shrink-0">
            <Button disabled={disabled} onClick={input.onSubmit} type="button">
              {submitButtonLabel}
            </Button>

            {input.onDelete === null && input.onViewActivity === null ? null : (
              <MoreActionsMenu
                disabled={disabled}
                triggerIconVariant="chevron-down"
                triggerLabel="More trigger actions"
                triggerSize="icon"
                triggerVariant="default"
              >
                {input.onViewActivity === null ? null : (
                  <DropdownMenuItem disabled={disabled} onClick={input.onViewActivity}>
                    <ClockCounterClockwiseIcon aria-hidden className="size-4" />
                    View Activity
                  </DropdownMenuItem>
                )}
                {input.onDelete === null ? null : (
                  <DropdownMenuItem
                    disabled={disabled}
                    onClick={input.onDelete}
                    variant="destructive"
                  >
                    <TrashIcon aria-hidden className="size-4" />
                    Delete trigger
                  </DropdownMenuItem>
                )}
              </MoreActionsMenu>
            )}
          </ButtonGroup>
        </div>
      ) : null}

      {input.formError === null ? null : (
        <Notice title="Trigger could not be saved" variant="alert">
          {input.formError}
        </Notice>
      )}

      {input.sandboxProfileStatusMessage === undefined ? null : (
        <Notice variant={input.sandboxProfileStatusMessage.variant}>
          {input.sandboxProfileStatusMessage.message}
        </Notice>
      )}

      <FormPageSection>
        {input.shouldShowTriggerEnabledField ? (
          <div className="px-4 py-4">
            <div className="flex min-h-10 items-center justify-between gap-3">
              <div className="space-y-1">
                <FieldLabel htmlFor={triggerEnabledId}>Trigger enabled</FieldLabel>
              </div>
              <Switch
                aria-label="Trigger enabled"
                checked={input.enabled}
                disabled={disabled}
                id={triggerEnabledId}
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
            {triggerTypeField}
            {triggerNameField}
          </>
        ) : (
          <>
            {triggerNameField}
            {triggerTypeField}
            {sandboxProfileField}
          </>
        )}

        {input.shouldShowPrimaryRepositoryField ? (
          <div className="p-4">
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
                <TriggerFormFieldError message={input.fieldErrors.primaryRepositoryId} />
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
                <TriggerFormFieldError message={input.fieldErrors.inputTemplate} />
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
          {submitButtonLabel}
        </Button>
      </FormPageFooter>
    </FormPageStack>
  );
}
