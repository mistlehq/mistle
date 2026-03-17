import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Checkbox,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Field,
  FieldContent,
  FieldLabel,
  Input,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@mistle/ui";
import { CaretDownIcon, TrashIcon } from "@phosphor-icons/react";

import { WebhookAutomationTitleEditor } from "./webhook-automation-title-editor.js";
import { WebhookAutomationTriggerPicker } from "./webhook-automation-trigger-picker.js";
import type {
  WebhookAutomationEventOption,
  WebhookAutomationTriggerParameterValueMap,
} from "./webhook-automation-trigger-types.js";
import {
  buildPayloadFilterFromConditions,
  createEmptyPayloadFilterConditionDraft,
  parsePayloadFilterBuilder,
  type PayloadFilterBuilderMode,
  type PayloadFilterConditionDraft,
  type PayloadFilterBuilderOperator,
  type PayloadFilterBuilderValueType,
} from "./webhook-payload-filter-builder.js";

export type {
  PayloadFilterBuilderMode,
  PayloadFilterBuilderOperator,
  PayloadFilterBuilderValueType,
  PayloadFilterConditionDraft,
} from "./webhook-payload-filter-builder.js";
export type { WebhookAutomationEventOption } from "./webhook-automation-trigger-types.js";

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
  eventTypes: string[];
  triggerParameterValues: WebhookAutomationTriggerParameterValueMap;
  payloadFilterEditorMode: "builder" | "json";
  payloadFilterBuilderMode: PayloadFilterBuilderMode;
  payloadFilterConditions: PayloadFilterConditionDraft[];
  payloadFilterText: string;
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
  isSaving: boolean;
  isDeleting: boolean;
  onValueChange: (
    key: WebhookAutomationFormValueKey,
    value:
      | string
      | boolean
      | string[]
      | PayloadFilterConditionDraft[]
      | WebhookAutomationTriggerParameterValueMap,
  ) => void;
  onSubmit: () => void;
  onDelete: (() => void) | null;
};

const PayloadFilterOperatorOptions: ReadonlyArray<{
  value: PayloadFilterBuilderOperator;
  label: string;
}> = [
  { value: "eq", label: "is" },
  { value: "neq", label: "is not" },
  { value: "in", label: "is one of" },
  { value: "contains", label: "contains" },
  { value: "starts_with", label: "starts with" },
  { value: "ends_with", label: "ends with" },
  { value: "exists", label: "exists" },
  { value: "not_exists", label: "does not exist" },
];

const PayloadFilterValueTypeOptions: ReadonlyArray<{
  value: PayloadFilterBuilderValueType;
  label: string;
}> = [
  { value: "string", label: "Text" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Boolean" },
  { value: "null", label: "Null" },
];

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

function buildPayloadFilterTextFromBuilder(input: {
  mode: PayloadFilterBuilderMode;
  conditions: readonly PayloadFilterConditionDraft[];
}): string {
  const builtFilter = buildPayloadFilterFromConditions(input);
  if (!builtFilter.success) {
    return "";
  }

  return builtFilter.value === null ? "" : JSON.stringify(builtFilter.value, null, 2);
}

function updatePayloadFilterConditionAtIndex(input: {
  conditions: readonly PayloadFilterConditionDraft[];
  index: number;
  condition: PayloadFilterConditionDraft;
}): PayloadFilterConditionDraft[] {
  return input.conditions.map((candidateCondition, candidateIndex) =>
    candidateIndex === input.index ? input.condition : candidateCondition,
  );
}

function parseJsonObject(
  value: string,
): { success: true; value: Record<string, unknown> | null } | { success: false } {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return { success: true, value: null };
  }

  try {
    const parsed = JSON.parse(normalized);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { success: false };
    }

    return { success: true, value: parsed };
  } catch {
    return { success: false };
  }
}

function PayloadFilterBuilderField(input: {
  values: WebhookAutomationFormValues;
  error: string | undefined;
  onValueChange: (
    key: WebhookAutomationFormValueKey,
    value: string | PayloadFilterConditionDraft[],
  ) => void;
}): React.JSX.Element {
  function updateConditions(nextConditions: PayloadFilterConditionDraft[]): void {
    input.onValueChange("payloadFilterConditions", nextConditions);
    input.onValueChange(
      "payloadFilterText",
      buildPayloadFilterTextFromBuilder({
        mode: input.values.payloadFilterBuilderMode,
        conditions: nextConditions,
      }),
    );
  }

  function updateBuilderMode(nextMode: PayloadFilterBuilderMode): void {
    input.onValueChange("payloadFilterBuilderMode", nextMode);
    input.onValueChange(
      "payloadFilterText",
      buildPayloadFilterTextFromBuilder({
        mode: nextMode,
        conditions: input.values.payloadFilterConditions,
      }),
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <FieldLabel>Match</FieldLabel>
        <RadioGroup
          className="flex flex-wrap gap-4"
          onValueChange={(value) => {
            if (value === null || (value !== "all" && value !== "any")) {
              return;
            }

            updateBuilderMode(value);
          }}
          value={input.values.payloadFilterBuilderMode}
        >
          <label className="flex items-center gap-2 text-sm">
            <RadioGroupItem value="all" />
            Match all conditions
          </label>
          <label className="flex items-center gap-2 text-sm">
            <RadioGroupItem value="any" />
            Match any condition
          </label>
        </RadioGroup>
      </div>

      <div className="space-y-3">
        {input.values.payloadFilterConditions.map((condition, index) => {
          const showScalarValueField =
            condition.operator !== "in" &&
            condition.operator !== "exists" &&
            condition.operator !== "not_exists";
          const showValueTypeField =
            condition.operator === "eq" ||
            condition.operator === "neq" ||
            condition.operator === "in";
          const showListValueField = condition.operator === "in";

          return (
            <div className="space-y-3 rounded-lg border p-4" key={condition.id}>
              <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1fr)]">
                <Field>
                  <FieldLabel>Payload field</FieldLabel>
                  <FieldContent>
                    <Input
                      onChange={(event) => {
                        updateConditions(
                          updatePayloadFilterConditionAtIndex({
                            conditions: input.values.payloadFilterConditions,
                            index,
                            condition: {
                              ...condition,
                              pathText: event.currentTarget.value,
                            },
                          }),
                        );
                      }}
                      placeholder="repository.full_name"
                      value={condition.pathText}
                    />
                  </FieldContent>
                </Field>

                <Field>
                  <FieldLabel>Operator</FieldLabel>
                  <FieldContent>
                    <Select
                      onValueChange={(value) => {
                        if (value === null) {
                          return;
                        }

                        const nextOperator = value as PayloadFilterBuilderOperator;
                        updateConditions(
                          updatePayloadFilterConditionAtIndex({
                            conditions: input.values.payloadFilterConditions,
                            index,
                            condition: {
                              ...condition,
                              operator: nextOperator,
                              ...(nextOperator === "contains" ||
                              nextOperator === "starts_with" ||
                              nextOperator === "ends_with"
                                ? { valueType: "string" as const }
                                : {}),
                            },
                          }),
                        );
                      }}
                      value={condition.operator}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PayloadFilterOperatorOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FieldContent>
                </Field>

                {showValueTypeField ? (
                  <Field>
                    <FieldLabel>Value type</FieldLabel>
                    <FieldContent>
                      <Select
                        onValueChange={(value) => {
                          if (value === null) {
                            return;
                          }

                          updateConditions(
                            updatePayloadFilterConditionAtIndex({
                              conditions: input.values.payloadFilterConditions,
                              index,
                              condition: {
                                ...condition,
                                valueType: value as PayloadFilterBuilderValueType,
                              },
                            }),
                          );
                        }}
                        value={condition.valueType}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PayloadFilterValueTypeOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FieldContent>
                  </Field>
                ) : (
                  <div />
                )}
              </div>

              {showListValueField ? (
                <Field>
                  <FieldLabel>Values</FieldLabel>
                  <FieldContent>
                    <Input
                      onChange={(event) => {
                        updateConditions(
                          updatePayloadFilterConditionAtIndex({
                            conditions: input.values.payloadFilterConditions,
                            index,
                            condition: {
                              ...condition,
                              valuesText: event.currentTarget.value,
                            },
                          }),
                        );
                      }}
                      placeholder="open, triaged, blocked"
                      value={condition.valuesText}
                    />
                  </FieldContent>
                </Field>
              ) : null}

              {showScalarValueField ? (
                <Field>
                  <FieldLabel>Value</FieldLabel>
                  <FieldContent>
                    {condition.valueType === "boolean" &&
                    (condition.operator === "eq" || condition.operator === "neq") ? (
                      <Select
                        onValueChange={(value) => {
                          if (value === null) {
                            return;
                          }

                          updateConditions(
                            updatePayloadFilterConditionAtIndex({
                              conditions: input.values.payloadFilterConditions,
                              index,
                              condition: {
                                ...condition,
                                valueText: value,
                              },
                            }),
                          );
                        }}
                        value={condition.valueText}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select boolean value" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="true">true</SelectItem>
                          <SelectItem value="false">false</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : condition.valueType === "null" &&
                      (condition.operator === "eq" || condition.operator === "neq") ? (
                      <Input disabled value="null" />
                    ) : (
                      <Input
                        onChange={(event) => {
                          updateConditions(
                            updatePayloadFilterConditionAtIndex({
                              conditions: input.values.payloadFilterConditions,
                              index,
                              condition: {
                                ...condition,
                                valueText: event.currentTarget.value,
                              },
                            }),
                          );
                        }}
                        placeholder="opened"
                        value={condition.valueText}
                      />
                    )}
                  </FieldContent>
                </Field>
              ) : null}

              <div className="flex justify-end">
                <Button
                  onClick={() => {
                    updateConditions(
                      input.values.payloadFilterConditions.filter(
                        (_, candidateIndex) => candidateIndex !== index,
                      ),
                    );
                  }}
                  type="button"
                  variant="ghost"
                >
                  Remove condition
                </Button>
              </div>
            </div>
          );
        })}

        <Button
          onClick={() => {
            updateConditions([
              ...input.values.payloadFilterConditions,
              createEmptyPayloadFilterConditionDraft(
                `condition_${String(input.values.payloadFilterConditions.length)}`,
              ),
            ]);
          }}
          type="button"
          variant="outline"
        >
          Add condition
        </Button>
      </div>

      <FieldError message={input.error} />
    </div>
  );
}

export function WebhookAutomationForm(input: WebhookAutomationFormProps): React.JSX.Element {
  const submitLabel = input.mode === "create" ? "Create automation" : "Save changes";

  function switchPayloadFilterEditorMode(nextMode: "builder" | "json"): void {
    if (nextMode === input.values.payloadFilterEditorMode) {
      return;
    }

    if (nextMode === "builder") {
      const parsedPayloadFilter = parseJsonObject(input.values.payloadFilterText);
      if (!parsedPayloadFilter.success) {
        return;
      }

      const parsedBuilder = parsePayloadFilterBuilder({
        payloadFilter: parsedPayloadFilter.value,
      });
      if (!parsedBuilder.supported) {
        return;
      }

      input.onValueChange("payloadFilterBuilderMode", parsedBuilder.mode);
      input.onValueChange("payloadFilterConditions", parsedBuilder.conditions);
    }

    input.onValueChange("payloadFilterEditorMode", nextMode);
  }

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

      <FormSection description="" title="Triggers">
        <div className="space-y-5">
          <WebhookAutomationTriggerPicker
            error={input.fieldErrors.eventTypes}
            eventOptions={input.webhookEventOptions}
            hasConnectedIntegrations={input.connectionOptions.length > 0}
            onTriggerParameterValueChange={({ eventType, parameterId, value }) => {
              input.onValueChange("triggerParameterValues", {
                ...input.values.triggerParameterValues,
                [eventType]: {
                  ...(input.values.triggerParameterValues[eventType] ?? {}),
                  [parameterId]: value,
                },
              });
            }}
            onValueChange={(value) => {
              input.onValueChange("eventTypes", value);
            }}
            selectedConnectionId={input.values.integrationConnectionId}
            selectedEventTypes={input.values.eventTypes}
            triggerParameterValues={input.values.triggerParameterValues}
          />
          <FieldError message={input.fieldErrors.eventTypes} />

          <div className="space-y-3">
            <div className="space-y-1">
              <h3 className="text-sm font-medium">Advanced conditions</h3>
              <p className="text-muted-foreground text-sm">
                Optionally add extra payload filters beyond the trigger parameters above.
              </p>
            </div>

            <Tabs
              onValueChange={(value) => {
                if (value !== "builder" && value !== "json") {
                  return;
                }

                switchPayloadFilterEditorMode(value);
              }}
              value={input.values.payloadFilterEditorMode}
            >
              <TabsList>
                <TabsTrigger value="builder">Builder</TabsTrigger>
                <TabsTrigger value="json">JSON</TabsTrigger>
              </TabsList>

              <TabsContent value="builder">
                <PayloadFilterBuilderField
                  error={input.fieldErrors.payloadFilterText}
                  onValueChange={(key, value) => {
                    input.onValueChange(key, value);
                  }}
                  values={input.values}
                />
              </TabsContent>

              <TabsContent value="json">
                <Field>
                  <FieldLabel htmlFor="payload-filter-json">Payload filter JSON</FieldLabel>
                  <FieldContent>
                    <Textarea
                      id="payload-filter-json"
                      onChange={(event) => {
                        input.onValueChange("payloadFilterText", event.currentTarget.value);
                      }}
                      placeholder='Optional filter JSON, for example {"op":"eq","path":["action"],"value":"opened"}'
                      rows={8}
                      value={input.values.payloadFilterText}
                    />
                    <FieldError message={input.fieldErrors.payloadFilterText} />
                  </FieldContent>
                </Field>
              </TabsContent>
            </Tabs>

            <Collapsible>
              <CollapsibleTrigger
                render={<Button type="button" variant="ghost" className="justify-start px-0" />}
              >
                <CaretDownIcon aria-hidden className="size-4" />
                View current filter JSON
              </CollapsibleTrigger>
              <CollapsibleContent>
                <pre className="bg-muted/40 overflow-x-auto rounded-lg border p-4 text-xs">
                  {input.values.payloadFilterText.trim().length === 0
                    ? "{}"
                    : input.values.payloadFilterText}
                </pre>
              </CollapsibleContent>
            </Collapsible>
          </div>
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
