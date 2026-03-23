import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Checkbox,
  Field,
  FieldContent,
  FieldLabel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@mistle/ui";
import { TrashIcon } from "@phosphor-icons/react";

import { resolveCommonWebhookAutomationConversationKeyOptions } from "./webhook-automation-conversation-key-options.js";
import { WebhookAutomationTitleEditor } from "./webhook-automation-title-editor.js";
import { WebhookAutomationTriggerPicker } from "./webhook-automation-trigger-picker.js";
import { resolveSelectedWebhookAutomationEventOptions } from "./webhook-automation-trigger-picker.js";
import type {
  WebhookAutomationConversationKeyOption,
  WebhookAutomationEventOption,
  WebhookAutomationTriggerParameterValueMap,
} from "./webhook-automation-trigger-types.js";
export type { WebhookAutomationEventOption } from "./webhook-automation-trigger-types.js";

export type WebhookAutomationFormOption = {
  value: string;
  label: string;
  description?: string;
};

export type WebhookAutomationFormValues = {
  name: string;
  sandboxProfileId: string;
  enabled: boolean;
  instructions: string;
  conversationKeyTemplate: string;
  triggerIds: string[];
  triggerParameterValues: WebhookAutomationTriggerParameterValueMap;
};

export type WebhookAutomationFormValueKey = keyof WebhookAutomationFormValues;

type WebhookAutomationFormProps = {
  mode: "create" | "edit";
  values: WebhookAutomationFormValues;
  connectionOptions: readonly WebhookAutomationFormOption[];
  sandboxProfileOptions: readonly WebhookAutomationFormOption[];
  webhookEventOptions: readonly WebhookAutomationEventOption[];
  fieldErrors: Partial<Record<WebhookAutomationFormValueKey, string>>;
  formError: string | null;
  isTemplateEditable: boolean;
  isSaving: boolean;
  isDeleting: boolean;
  onValueChange: (
    key: WebhookAutomationFormValueKey,
    value: string | boolean | string[] | WebhookAutomationTriggerParameterValueMap,
  ) => void;
  onSubmit: () => void;
  onDelete: (() => void) | null;
};

function FieldError(input: { message: string | undefined }): React.JSX.Element | null {
  if (input.message === undefined) {
    return null;
  }

  return <p className="text-destructive text-sm">{input.message}</p>;
}

function SelectField(input: {
  label: string;
  value: string;
  placeholder: string;
  options: readonly WebhookAutomationFormOption[];
  error: string | undefined;
  onValueChange: (value: string) => void;
}): React.JSX.Element {
  const selectedOption = input.options.find((option) => option.value === input.value);

  return (
    <Field>
      <FieldLabel>{input.label}</FieldLabel>
      <FieldContent>
        <Select
          onValueChange={(value) => {
            if (value === null) {
              return;
            }

            input.onValueChange(value);
          }}
          value={input.value}
        >
          <SelectTrigger className="w-full">
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
        <FieldError message={input.error} />
      </FieldContent>
    </Field>
  );
}

function FormSection(input: {
  title: string;
  description: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const hasHeading = input.title.trim().length > 0 || input.description.trim().length > 0;

  return (
    <section className="space-y-5 border-t pt-6 first:border-t-0 first:pt-0">
      {hasHeading ? (
        <div className="space-y-1">
          {input.title.trim().length > 0 ? (
            <h2 className="text-base font-semibold">{input.title}</h2>
          ) : null}
          {input.description.trim().length > 0 ? (
            <p className="text-muted-foreground text-sm">{input.description}</p>
          ) : null}
        </div>
      ) : null}
      {input.children}
    </section>
  );
}

export function resolveConversationKeyFieldOptions(input: {
  selectedEventOptions: readonly WebhookAutomationEventOption[];
  currentTemplate: string;
}): {
  supportedOptions: readonly WebhookAutomationConversationKeyOption[];
  displayOptions: readonly WebhookAutomationConversationKeyOption[];
  hasUnsupportedCurrentTemplate: boolean;
} {
  const supportedOptions = resolveCommonWebhookAutomationConversationKeyOptions({
    selectedEventOptions: input.selectedEventOptions,
  });

  if (
    input.currentTemplate.trim().length === 0 ||
    supportedOptions.some((option) => option.template === input.currentTemplate)
  ) {
    return {
      supportedOptions,
      displayOptions: supportedOptions,
      hasUnsupportedCurrentTemplate: false,
    };
  }

  return {
    supportedOptions,
    displayOptions: [
      {
        id: "__current_unsupported__",
        label: "Current setting (unsupported)",
        description:
          "This saved grouping is no longer supported for the selected triggers. Choose a supported option before saving.",
        template: input.currentTemplate,
      },
      ...supportedOptions,
    ],
    hasUnsupportedCurrentTemplate: true,
  };
}

export function WebhookAutomationForm(input: WebhookAutomationFormProps): React.JSX.Element {
  const submitLabel = input.mode === "create" ? "Create automation" : "Save changes";
  const selectedTriggerOptions = resolveSelectedWebhookAutomationEventOptions({
    eventOptions: input.webhookEventOptions,
    selectedTriggerIds: input.values.triggerIds,
  });
  const selectedConnectionIds = new Set(
    selectedTriggerOptions
      .map((option) => option.connectionId)
      .filter((connectionId) => connectionId.trim().length > 0),
  );
  const selectedConnectionId =
    selectedConnectionIds.size === 1 ? ([...selectedConnectionIds][0] ?? "") : "";
  const conversationKeyFieldOptions = resolveConversationKeyFieldOptions({
    selectedEventOptions: selectedTriggerOptions,
    currentTemplate: input.values.conversationKeyTemplate,
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-3">
        {input.mode === "edit" ? (
          <div className="min-w-0 flex-1">
            <WebhookAutomationTitleEditor
              errorMessage={input.fieldErrors.name}
              mode={input.mode}
              onCommit={(nextValue) => {
                input.onValueChange("name", nextValue);
              }}
              saveDisabled={input.isDeleting || input.isSaving}
              title={input.values.name}
            />
          </div>
        ) : (
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold">Create Automation</h1>
          </div>
        )}

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

      {input.formError === null ? null : (
        <Alert variant="destructive">
          <AlertTitle>Could not save automation</AlertTitle>
          <AlertDescription>{input.formError}</AlertDescription>
        </Alert>
      )}

      <FormSection description="" title="Basics">
        <div className="space-y-5">
          <div className="grid gap-5 md:grid-cols-2">
            {input.mode === "create" ? (
              <WebhookAutomationTitleEditor
                errorMessage={input.fieldErrors.name}
                mode={input.mode}
                onCommit={(nextValue) => {
                  input.onValueChange("name", nextValue);
                }}
                saveDisabled={input.isDeleting || input.isSaving}
                title={input.values.name}
              />
            ) : null}

            <SelectField
              error={input.fieldErrors.sandboxProfileId}
              label="Sandbox profile"
              onValueChange={(value) => {
                input.onValueChange("sandboxProfileId", value);
              }}
              options={input.sandboxProfileOptions}
              placeholder="Select profile"
              value={input.values.sandboxProfileId}
            />
          </div>

          {input.mode === "edit" ? (
            <div className="bg-muted/40 flex items-start gap-3 rounded-lg border p-4">
              <Checkbox
                checked={input.values.enabled}
                id="automation-enabled"
                onCheckedChange={(checked) => {
                  input.onValueChange("enabled", checked === true);
                }}
              />
              <div className="space-y-1">
                <FieldLabel htmlFor="automation-enabled">Automation enabled</FieldLabel>
              </div>
            </div>
          ) : null}
        </div>
      </FormSection>

      <FormSection
        description="These instructions are sent together with the webhook event type and full payload."
        title="Instructions"
      >
        <Field>
          <FieldLabel htmlFor="automation-instructions">Instructions</FieldLabel>
          <FieldContent>
            <Textarea
              id="automation-instructions"
              disabled={!input.isTemplateEditable || input.isDeleting || input.isSaving}
              onChange={(event) => {
                input.onValueChange("instructions", event.currentTarget.value);
              }}
              rows={7}
              value={input.values.instructions}
            />
            <p className="text-muted-foreground text-sm">
              The automation will always receive your instructions, the webhook event type, and the
              full webhook payload.
            </p>
            <FieldError message={input.fieldErrors.instructions} />
          </FieldContent>
        </Field>
      </FormSection>

      <FormSection description="" title="Triggers">
        <div className="space-y-5">
          <WebhookAutomationTriggerPicker
            error={input.fieldErrors.triggerIds}
            eventOptions={input.webhookEventOptions}
            hasConnectedIntegrations={input.connectionOptions.length > 0}
            onTriggerParameterValueChange={({ triggerId, parameterId, value }) => {
              input.onValueChange("triggerParameterValues", {
                ...input.values.triggerParameterValues,
                [triggerId]: {
                  ...(input.values.triggerParameterValues[triggerId] ?? {}),
                  [parameterId]: value,
                },
              });
            }}
            onValueChange={(value) => {
              input.onValueChange("triggerIds", value);
            }}
            selectedConnectionId={selectedConnectionId}
            selectedTriggerIds={input.values.triggerIds}
            triggerParameterValues={input.values.triggerParameterValues}
          />
          <FieldError message={input.fieldErrors.triggerIds} />

          <Field>
            <FieldLabel>Conversation grouping</FieldLabel>
            <FieldContent>
              <Select
                disabled={conversationKeyFieldOptions.displayOptions.length === 0}
                onValueChange={(value) => {
                  if (value === null) {
                    return;
                  }

                  input.onValueChange("conversationKeyTemplate", value);
                }}
                value={input.values.conversationKeyTemplate}
              >
                <SelectTrigger className="w-full">
                  <SelectValue
                    placeholder={
                      input.values.triggerIds.length === 0
                        ? "Select triggers first"
                        : "Select conversation grouping"
                    }
                  >
                    {
                      conversationKeyFieldOptions.displayOptions.find(
                        (option) => option.template === input.values.conversationKeyTemplate,
                      )?.label
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {conversationKeyFieldOptions.displayOptions.map((option) => (
                    <SelectItem key={option.id} value={option.template}>
                      <div className="flex flex-col gap-0.5">
                        <span>{option.label}</span>
                        <span className="text-muted-foreground text-xs">{option.description}</span>
                        <code className="text-muted-foreground text-[11px]">{option.template}</code>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-sm">
                Events that render to the same key are routed into the same conversation.
              </p>
              <FieldError message={input.fieldErrors.conversationKeyTemplate} />
            </FieldContent>
          </Field>
        </div>
      </FormSection>

      <div className="flex justify-end">
        <Button
          disabled={!input.isTemplateEditable || input.isDeleting || input.isSaving}
          onClick={input.onSubmit}
          type="button"
        >
          {input.isSaving ? "Saving..." : submitLabel}
        </Button>
      </div>
    </div>
  );
}
