import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
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

export type WebhookAutomationFormOption = {
  value: string;
  label: string;
  description?: string;
};

export type WebhookAutomationFormValues = {
  name: string;
  integrationConnectionId: string;
  sandboxProfileId: string;
  sandboxProfileVersion: string;
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

export function WebhookAutomationForm(input: WebhookAutomationFormProps): React.JSX.Element {
  const submitLabel = input.mode === "create" ? "Create automation" : "Save changes";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">
            {input.mode === "create" ? "Create automation" : "Edit automation"}
          </h1>
          <p className="text-muted-foreground text-sm">
            Connect a webhook-capable integration to a sandbox profile and control how the incoming
            event payload becomes automation input.
          </p>
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

      <Card>
        <CardHeader>
          <CardTitle>Basics</CardTitle>
          <CardDescription>
            Choose the integration connection and sandbox profile this automation should target.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <Field>
            <FieldLabel htmlFor="automation-name">Automation name</FieldLabel>
            <FieldContent>
              <Input
                id="automation-name"
                onChange={(event) => {
                  input.onValueChange("name", event.currentTarget.value);
                }}
                value={input.values.name}
              />
              <FieldError message={input.fieldErrors.name} />
            </FieldContent>
          </Field>

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

          <Field>
            <FieldLabel htmlFor="sandbox-profile-version">Sandbox profile version</FieldLabel>
            <FieldContent>
              <Input
                id="sandbox-profile-version"
                onChange={(event) => {
                  input.onValueChange("sandboxProfileVersion", event.currentTarget.value);
                }}
                placeholder="Leave blank to use the latest compatible version"
                value={input.values.sandboxProfileVersion}
              />
              <FieldError message={input.fieldErrors.sandboxProfileVersion} />
            </FieldContent>
          </Field>

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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Templates</CardTitle>
          <CardDescription>
            These values are sent directly to the backend contract. Keep them aligned with the
            integration payload shape you expect.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Advanced filters</CardTitle>
          <CardDescription>
            Use these optional fields to narrow which events trigger the automation and what subset
            of the payload gets accepted.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
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
        </CardContent>
      </Card>

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
