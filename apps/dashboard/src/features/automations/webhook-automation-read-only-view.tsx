import { Alert, AlertDescription, AlertTitle, Button, FieldLabel } from "@mistle/ui";
import { TrashIcon } from "@phosphor-icons/react";

import { FormPageFooter, FormPageSection } from "../shared/form-page.js";
import type {
  WebhookAutomationEventOption,
  WebhookAutomationFormValues,
} from "./webhook-automation-form.js";
import { resolveSelectedWebhookAutomationEventOptions } from "./webhook-automation-trigger-picker.js";

export function WebhookAutomationReadOnlyView(input: {
  values: WebhookAutomationFormValues;
  sandboxProfileName: string;
  triggerOptions: readonly WebhookAutomationEventOption[];
  onDelete: () => void;
  onReconfigure: () => void;
  isDeleting: boolean;
}): React.JSX.Element {
  const selectedTriggerOptions = resolveSelectedWebhookAutomationEventOptions({
    eventOptions: input.triggerOptions,
    selectedTriggerIds: input.values.triggerIds,
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold">{input.values.name}</h1>
        </div>
        <Button
          aria-label="Delete automation"
          disabled={input.isDeleting}
          onClick={input.onDelete}
          size="icon-sm"
          type="button"
          variant="outline"
        >
          <TrashIcon aria-hidden className="size-4" />
        </Button>
      </div>

      <Alert>
        <AlertTitle>This automation is no longer editable</AlertTitle>
        <AlertDescription>
          This automation&apos;s sandbox profile configuration is no longer valid for
          webhook-triggered automations. The saved configuration is shown below for reference. You
          can reconfigure it using a currently applicable profile or delete it.
        </AlertDescription>
      </Alert>

      <FormPageSection>
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <ReadOnlyField label="Status" value={input.values.enabled ? "Enabled" : "Disabled"} />
          <ReadOnlyField label="Sandbox profile" value={input.sandboxProfileName} />
        </div>
      </FormPageSection>

      <FormPageSection header={<h2 className="text-base font-semibold">Triggers</h2>}>
        <div className="space-y-3 p-4">
          {selectedTriggerOptions.length === 0 ? (
            <p className="text-muted-foreground text-sm">No triggers were configured.</p>
          ) : (
            selectedTriggerOptions.map((option) => (
              <div className="bg-muted/20 space-y-2 rounded-lg border px-3.5 py-3" key={option.id}>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{option.label}</p>
                  {option.unavailable === true ? (
                    <span className="text-destructive text-xs">Unavailable</span>
                  ) : null}
                </div>
                <p className="text-muted-foreground text-sm">
                  {option.connectionLabel.trim().length > 0
                    ? option.connectionLabel
                    : option.connectionId}
                </p>
                {option.parameters === undefined || option.parameters.length === 0 ? null : (
                  <div className="space-y-1">
                    {option.parameters.map((parameter) => {
                      const value =
                        input.values.triggerParameterValues[option.id]?.[parameter.id] ?? "";

                      return (
                        <ReadOnlyField
                          key={`${option.id}:${parameter.id}`}
                          label={parameter.label}
                          value={value.trim().length === 0 ? "Not set" : value}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </FormPageSection>

      <FormPageSection>
        <div className="grid gap-4 p-4">
          <ReadOnlyField
            label="Conversation grouping template"
            value={input.values.conversationKeyTemplate}
          />
          <ReadOnlyBlock label="Agent instructions" value={input.values.instructions} />
        </div>
      </FormPageSection>

      <FormPageFooter>
        <Button onClick={input.onReconfigure} type="button" variant="outline">
          Reconfigure automation
        </Button>
      </FormPageFooter>
    </div>
  );
}

function ReadOnlyField(input: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="space-y-1">
      <FieldLabel>{input.label}</FieldLabel>
      <p className="text-sm leading-6">{input.value}</p>
    </div>
  );
}

function ReadOnlyBlock(input: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="space-y-1">
      <FieldLabel>{input.label}</FieldLabel>
      <div className="rounded border bg-muted/10 px-3 py-2">
        <p className="text-sm whitespace-pre-wrap">{input.value}</p>
      </div>
    </div>
  );
}
