import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldContent,
  FieldDescription,
  FieldHeader,
  FieldLabel,
  Input,
  Textarea,
  TextLink,
} from "@mistle/ui";
import { useState, type SyntheticEvent } from "react";

import type { IntegrationConnection } from "./integrations-service.js";

type IntegrationWebhookTriggerCapabilitiesRefreshAction = NonNullable<
  IntegrationConnection["webhookTriggerCapabilitiesRefreshAction"]
>;

type IntegrationWebhookTriggerCapabilitiesRefreshActionField = NonNullable<
  IntegrationWebhookTriggerCapabilitiesRefreshAction["bodyForm"]
>["fields"][number];

export function IntegrationWebhookTriggerCapabilitiesRefreshDialog(input: {
  action: IntegrationWebhookTriggerCapabilitiesRefreshAction | null;
  isOpen: boolean;
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onSync: (body: Readonly<Record<string, unknown>>) => void;
}): React.JSX.Element {
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const action = input.action;
  const form = action?.bodyForm;
  const content = input.isOpen && action !== null && form !== undefined ? { action, form } : null;

  function handleOpenChange(open: boolean): void {
    if (!open) {
      setFormValues({});
    }

    input.onOpenChange(open);
  }

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (
      input.isPending ||
      form === undefined ||
      !isFormComplete({ fields: form.fields, formValues })
    ) {
      return;
    }

    input.onSync(buildBodyFromFormValues({ fields: form.fields, formValues }));
    setFormValues({});
  }

  return (
    <Dialog
      isBusy={input.isPending}
      isDismissible={!input.isPending}
      onOpenChange={handleOpenChange}
      open={input.isOpen}
    >
      {content === null ? null : (
        <DialogContent
          className="sm:max-w-xl"
          formProps={{
            className: "gap-6 grid",
            onSubmit: handleSubmit,
          }}
        >
          <DialogHeader>
            <DialogTitle>{content.form.title}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            {content.form.fields.map((field) => (
              <RefreshActionField
                disabled={input.isPending}
                field={field}
                key={field.name}
                onValueChange={(value) => {
                  setFormValues((currentValues) => ({
                    ...currentValues,
                    [field.name]: value,
                  }));
                }}
                value={formValues[field.name] ?? ""}
              />
            ))}
          </div>

          <DialogFooter>
            <Button
              disabled={input.isPending}
              onClick={() => {
                handleOpenChange(false);
              }}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={
                input.isPending || !isFormComplete({ fields: content.form.fields, formValues })
              }
              type="submit"
            >
              {input.isPending ? content.action.pendingLabel : content.form.submitLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}

function RefreshActionField(input: {
  disabled: boolean;
  field: IntegrationWebhookTriggerCapabilitiesRefreshActionField;
  onValueChange: (value: string) => void;
  value: string;
}): React.JSX.Element {
  const fieldId = `webhook-trigger-capabilities-refresh-${input.field.name}`;

  return (
    <Field>
      <FieldHeader>
        <FieldLabel htmlFor={fieldId} required={input.field.required === true}>
          {input.field.label}
        </FieldLabel>
        {input.field.description === undefined && input.field.actions === undefined ? null : (
          <FieldDescription>
            {input.field.description}
            {input.field.actions?.map((action) => (
              <span key={action.href}>
                {" "}
                <TextLink
                  href={action.href}
                  {...(action.opensInNewWindow === undefined
                    ? {}
                    : { opensInNewWindow: action.opensInNewWindow })}
                >
                  {action.label}
                </TextLink>
              </span>
            ))}
          </FieldDescription>
        )}
      </FieldHeader>
      <FieldContent>
        {input.field.inputType === "textarea" ? (
          <Textarea
            autoComplete="off"
            data-1p-ignore="true"
            disabled={input.disabled}
            id={fieldId}
            onChange={(event) => {
              input.onValueChange(event.currentTarget.value);
            }}
            placeholder={input.field.placeholder}
            value={input.value}
          />
        ) : (
          <Input
            autoComplete="off"
            data-1p-ignore="true"
            disabled={input.disabled}
            id={fieldId}
            onChange={(event) => {
              input.onValueChange(event.currentTarget.value);
            }}
            placeholder={input.field.placeholder}
            type={input.field.inputType}
            value={input.value}
          />
        )}
      </FieldContent>
    </Field>
  );
}

function isFormComplete(input: {
  fields: readonly IntegrationWebhookTriggerCapabilitiesRefreshActionField[];
  formValues: Readonly<Record<string, string>>;
}): boolean {
  return input.fields.every(
    (field) => field.required !== true || (input.formValues[field.name] ?? "").trim().length > 0,
  );
}

function buildBodyFromFormValues(input: {
  fields: readonly IntegrationWebhookTriggerCapabilitiesRefreshActionField[];
  formValues: Readonly<Record<string, string>>;
}): Readonly<Record<string, unknown>> {
  const body: Record<string, unknown> = {};

  for (const field of input.fields) {
    const trimmedValue = (input.formValues[field.name] ?? "").trim();
    if (trimmedValue.length > 0) {
      body[field.name] = trimmedValue;
    }
  }

  return body;
}
