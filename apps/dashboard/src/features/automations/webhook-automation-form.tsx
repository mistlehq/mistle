import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Checkbox,
  Field,
  FieldContent,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@mistle/ui";
import { TrashIcon } from "@phosphor-icons/react";

import { WebhookAutomationTitleEditor } from "./webhook-automation-title-editor.js";

export type WebhookAutomationFormOption = {
  value: string;
  label: string;
  description?: string;
};

export type WebhookAutomationFormValues = {
  name: string;
  integrationConnectionId: string;
  sandboxProfileId: string;
  enabled: boolean;
  inputTemplate: string;
  conversationKeyTemplate: string;
  idempotencyKeyTemplate: string;
  eventTypesText: string;
  payloadFilterText: string;
};

export type WebhookAutomationFormValueKey = keyof WebhookAutomationFormValues;

type WebhookAutomationFormProps = {
  mode: "create" | "edit";
  values: WebhookAutomationFormValues;
  connectionOptions: readonly WebhookAutomationFormOption[];
  sandboxProfileOptions: readonly WebhookAutomationFormOption[];
  fieldErrors: Partial<Record<WebhookAutomationFormValueKey, string>>;
  formError: string | null;
  isSaving: boolean;
  isDeleting: boolean;
  onValueChange: (key: WebhookAutomationFormValueKey, value: string | boolean) => void;
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
            <SelectValue placeholder={input.placeholder} />
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
  return (
    <section className="space-y-5 border-t pt-6 first:border-t-0 first:pt-0">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">{input.title}</h2>
        <p className="text-muted-foreground text-sm">{input.description}</p>
      </div>
      {input.children}
    </section>
  );
}

export function WebhookAutomationForm(input: WebhookAutomationFormProps): React.JSX.Element {
  const submitLabel = input.mode === "create" ? "Create automation" : "Save changes";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-3">
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

      <FormSection
        description="Choose the integration connection and sandbox profile this automation should target."
        title="Basics"
      >
        <div className="space-y-5">
          <div className="grid gap-5 md:grid-cols-2">
            <SelectField
              error={input.fieldErrors.integrationConnectionId}
              label="Integration connection"
              onValueChange={(value) => {
                input.onValueChange("integrationConnectionId", value);
              }}
              options={input.connectionOptions}
              placeholder="Select connection"
              value={input.values.integrationConnectionId}
            />

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
              <p className="text-muted-foreground text-sm">
                Disable the automation without deleting the configuration.
              </p>
            </div>
          </div>
        </div>
      </FormSection>

      <FormSection
        description="These values are sent directly to the backend contract. Keep them aligned with the integration payload shape you expect."
        title="Templates"
      >
        <div className="space-y-5">
          <Field>
            <FieldLabel htmlFor="conversation-key-template">Conversation key template</FieldLabel>
            <FieldContent>
              <Input
                id="conversation-key-template"
                onChange={(event) => {
                  input.onValueChange("conversationKeyTemplate", event.currentTarget.value);
                }}
                value={input.values.conversationKeyTemplate}
              />
              <FieldError message={input.fieldErrors.conversationKeyTemplate} />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel htmlFor="input-template">Input template</FieldLabel>
            <FieldContent>
              <Textarea
                id="input-template"
                onChange={(event) => {
                  input.onValueChange("inputTemplate", event.currentTarget.value);
                }}
                rows={7}
                value={input.values.inputTemplate}
              />
              <FieldError message={input.fieldErrors.inputTemplate} />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel htmlFor="idempotency-key-template">Idempotency key template</FieldLabel>
            <FieldContent>
              <Input
                id="idempotency-key-template"
                onChange={(event) => {
                  input.onValueChange("idempotencyKeyTemplate", event.currentTarget.value);
                }}
                placeholder="Optional"
                value={input.values.idempotencyKeyTemplate}
              />
              <FieldError message={input.fieldErrors.idempotencyKeyTemplate} />
            </FieldContent>
          </Field>
        </div>
      </FormSection>

      <FormSection
        description="Use these optional fields to narrow which events trigger the automation and what subset of the payload gets accepted."
        title="Advanced filters"
      >
        <div className="space-y-5">
          <Field>
            <FieldLabel htmlFor="event-types">Event types</FieldLabel>
            <FieldContent>
              <Input
                id="event-types"
                onChange={(event) => {
                  input.onValueChange("eventTypesText", event.currentTarget.value);
                }}
                placeholder="Comma-separated, for example push,pull_request"
                value={input.values.eventTypesText}
              />
              <FieldError message={input.fieldErrors.eventTypesText} />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel htmlFor="payload-filter">Payload filter</FieldLabel>
            <FieldContent>
              <Textarea
                id="payload-filter"
                onChange={(event) => {
                  input.onValueChange("payloadFilterText", event.currentTarget.value);
                }}
                placeholder='Optional JSON object, for example {"repository":"mistle"}'
                rows={5}
                value={input.values.payloadFilterText}
              />
              <FieldError message={input.fieldErrors.payloadFilterText} />
            </FieldContent>
          </Field>
        </div>
      </FormSection>

      <div className="flex justify-end">
        <Button
          disabled={input.isDeleting || input.isSaving}
          onClick={input.onSubmit}
          type="button"
        >
          {input.isSaving ? "Saving..." : submitLabel}
        </Button>
      </div>
    </div>
  );
}
