import {
  Checkbox,
  DetailLabel,
  DetailLabelWithTooltip,
  Field,
  FieldContent,
  FieldError,
  FieldHeader,
  FieldLabel,
  FieldLabelWithTooltip,
  FieldTitle,
  FieldTitleWithTooltip,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  cn,
} from "@mistle/ui";
import { withTheme } from "@rjsf/core";
import type {
  DescriptionFieldProps,
  FieldErrorProps,
  FieldHelpProps,
  FieldTemplateProps,
  ObjectFieldTemplateProps,
  RJSFSchema,
  SubmitButtonProps,
  WidgetProps,
} from "@rjsf/utils";
import {
  ariaDescribedByIds,
  enumOptionsDeselectValue,
  enumOptionsIsSelected,
  enumOptionsSelectValue,
  enumOptionsValueForIndex,
  optionId,
} from "@rjsf/utils";
import * as React from "react";

import { isRecord } from "../shared/is-record.js";
import { IntegrationResourcePickerWidget } from "./integration-resource-picker-widget.js";
import { MultiSelectStringArrayComboboxField } from "./multi-select-string-array-combobox-field.js";
import { SingleSelectStringComboboxField } from "./single-select-string-combobox-field.js";

type JsonObject = Record<string, unknown>;
type SchemaFormFieldLayout = "horizontal" | "vertical";

/**
 * Global layout mode for shared schema-driven forms.
 *
 * Contract:
 * - `vertical` is the default and stacks labels above controls.
 * - `horizontal` renders rows using the shared `Field` horizontal layout.
 * - individual fields may opt out of the horizontal row treatment by setting
 *   `ui:options.layout` to `"stacked"` in their uiSchema.
 */
export type SchemaFormLayout = "vertical" | "horizontal";
export type SchemaFormLabelTone = "default" | "detail";
export type SchemaFormContext = {
  /**
   * Form-wide default layout for RJSF surfaces using the shared schema form
   * theme. This is intentionally a small API that mirrors the patterns we use
   * in hand-built forms:
   * - set the form to `horizontal` when the editor is primarily row-based
   * - leave it `vertical` for dialog-style or stacked forms
   * - use field-level `ui:options.layout = "stacked"` for large fields that
   *   should remain vertical inside an otherwise horizontal form
   */
  layout?: SchemaFormLayout;
  /**
   * Optional label presentation for compact read/write surfaces that should
   * visually match summary metadata labels.
   */
  labelTone?: SchemaFormLabelTone;
  /**
   * Optional column count for vertical object layouts. Use this to render
   * compact side-by-side field groups while keeping each field internally
   * vertical.
   */
  columns?: 1 | 2;
};

function resolveSelectWidgetOptions(input: {
  options: WidgetProps<JsonObject, RJSFSchema, SchemaFormContext>["options"];
  formContext: SchemaFormContext | undefined;
}): {
  fitContent: boolean;
} {
  if (input.options.fitContent === false) {
    return {
      fitContent: false,
    };
  }

  return {
    fitContent: input.options.fitContent === true || input.formContext?.layout === "horizontal",
  };
}

export const SchemaFormHorizontalFieldGroupClassName = "gap-6 flex flex-col";
const SchemaFormVerticalFieldGroupClassName = "gap-6 flex flex-col";
export const SchemaFormSelectContentClassName =
  "w-max min-w-(--anchor-width) max-w-[min(32rem,calc(100vw-2rem))]";

function resolveCommaSeparatedOptions(
  options: WidgetProps<JsonObject, RJSFSchema, SchemaFormContext>["options"],
): {
  delimiter: string;
  placeholder: string | undefined;
} {
  const delimiter = typeof options.delimiter === "string" ? options.delimiter : ",";
  const placeholder = typeof options.placeholder === "string" ? options.placeholder : undefined;

  return {
    delimiter,
    placeholder,
  };
}

function resolveMultiSelectStringComboboxOptions(
  props: WidgetProps<JsonObject, RJSFSchema, SchemaFormContext>,
): readonly { label: string; value: string }[] {
  const itemsSchema = isRecord(props.schema.items) ? props.schema.items : null;
  if (itemsSchema === null) {
    return [];
  }

  if (Array.isArray(itemsSchema.oneOf)) {
    return itemsSchema.oneOf.flatMap((option: unknown) => {
      if (
        !isRecord(option) ||
        typeof option.const !== "string" ||
        typeof option.title !== "string"
      ) {
        return [];
      }

      return [
        {
          label: option.title,
          value: option.const,
        },
      ];
    });
  }

  if (!Array.isArray(itemsSchema.enum)) {
    return [];
  }

  const enumNames = Array.isArray(props.uiSchema?.["ui:enumNames"])
    ? props.uiSchema["ui:enumNames"]
    : [];

  return itemsSchema.enum.flatMap((entry: unknown, index: number) => {
    if (typeof entry !== "string") {
      return [];
    }

    const candidateLabel = enumNames[index];
    return [
      {
        label: typeof candidateLabel === "string" ? candidateLabel : entry,
        value: entry,
      },
    ];
  });
}

function resolveSingleSelectStringComboboxOptions(
  props: WidgetProps<JsonObject, RJSFSchema, SchemaFormContext>,
): readonly { label: string; value: string }[] {
  if (Array.isArray(props.schema.oneOf)) {
    return props.schema.oneOf.flatMap((option: unknown) => {
      if (
        !isRecord(option) ||
        typeof option.const !== "string" ||
        typeof option.title !== "string"
      ) {
        return [];
      }

      return [
        {
          label: option.title,
          value: option.const,
        },
      ];
    });
  }

  if (!Array.isArray(props.schema.enum)) {
    return [];
  }

  const enumNames = Array.isArray(props.uiSchema?.["ui:enumNames"])
    ? props.uiSchema["ui:enumNames"]
    : [];

  return props.schema.enum.flatMap((entry: unknown, index: number) => {
    if (typeof entry !== "string") {
      return [];
    }

    const candidateLabel = enumNames[index];
    return [
      {
        label: typeof candidateLabel === "string" ? candidateLabel : entry,
        value: entry,
      },
    ];
  });
}

function forwardWidgetBlur<TValue>(
  props: WidgetProps<JsonObject, RJSFSchema, SchemaFormContext>,
  value: TValue,
): void {
  props.onBlur(props.id, value);
}

function forwardWidgetFocus<TValue>(
  props: WidgetProps<JsonObject, RJSFSchema, SchemaFormContext>,
  value: TValue,
): void {
  props.onFocus(props.id, value);
}

function CommaSeparatedStringArrayWidget(
  props: WidgetProps<JsonObject, RJSFSchema, SchemaFormContext>,
): React.JSX.Element {
  const { delimiter, placeholder } = resolveCommaSeparatedOptions(props.options);
  const value = Array.isArray(props.value)
    ? props.value.filter((entry): entry is string => typeof entry === "string")
    : [];
  const normalizedValue = value.join(`${delimiter} `);
  const [draftValue, setDraftValue] = React.useState(() => normalizedValue);
  const [isFocused, setIsFocused] = React.useState(false);

  React.useEffect(() => {
    if (isFocused) {
      return;
    }

    setDraftValue(normalizedValue);
  }, [isFocused, normalizedValue]);

  function parseDraftValue(input: string): string[] {
    return input
      .split(delimiter)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  return (
    <Input
      aria-label={props.label}
      className="w-full"
      disabled={props.disabled || props.readonly}
      id={props.id}
      onBlur={() => {
        const nextValue = parseDraftValue(draftValue);
        const normalizedValue = nextValue.join(`${delimiter} `);
        setIsFocused(false);
        setDraftValue(normalizedValue);
        props.onChange(nextValue);
        props.onBlur(props.id, nextValue);
      }}
      onChange={(event) => {
        const nextDraftValue = event.currentTarget.value;
        setDraftValue(nextDraftValue);
      }}
      onFocus={() => {
        setIsFocused(true);
        props.onFocus(props.id, value);
      }}
      placeholder={placeholder}
      value={draftValue}
    />
  );
}

function MultiSelectStringArrayComboboxWidget(
  props: WidgetProps<JsonObject, RJSFSchema, SchemaFormContext>,
): React.JSX.Element {
  const selectedValues = Array.isArray(props.value)
    ? props.value.filter((entry): entry is string => typeof entry === "string")
    : [];
  const options = resolveMultiSelectStringComboboxOptions(props);
  return (
    <MultiSelectStringArrayComboboxField
      emptyMessage={
        typeof props.options.emptyMessage === "string"
          ? props.options.emptyMessage
          : "No matching options."
      }
      inputId={props.id}
      inputLabel={props.label}
      invalid={props.rawErrors !== undefined && props.rawErrors.length > 0}
      onBlur={(value) => {
        forwardWidgetBlur(props, value);
      }}
      onChange={(value) => {
        props.onChange(value);
      }}
      onFocus={(value) => {
        forwardWidgetFocus(props, value);
      }}
      options={options}
      placeholder={typeof props.placeholder === "string" ? props.placeholder : props.label}
      readonly={props.disabled || props.readonly}
      value={selectedValues}
    />
  );
}

function SingleSelectStringComboboxWidget(
  props: WidgetProps<JsonObject, RJSFSchema, SchemaFormContext>,
): React.JSX.Element {
  const options = resolveSingleSelectStringComboboxOptions(props);
  const selectedValue = typeof props.value === "string" ? props.value : "";
  const placeholder =
    typeof props.placeholder === "string"
      ? props.placeholder
      : typeof props.label === "string" && props.label.length > 0
        ? `Select ${props.label.toLowerCase()}`
        : "Select an option";

  return (
    <SingleSelectStringComboboxField
      emptyMessage={
        typeof props.options.emptyMessage === "string"
          ? props.options.emptyMessage
          : "No matching options."
      }
      inputId={props.id}
      inputLabel={props.label}
      invalid={props.rawErrors !== undefined && props.rawErrors.length > 0}
      onBlur={(value) => {
        forwardWidgetBlur(props, value);
      }}
      onChange={(value) => {
        props.onChange(value);
      }}
      onFocus={(value) => {
        forwardWidgetFocus(props, value);
      }}
      options={options}
      placeholder={placeholder}
      readonly={props.disabled || props.readonly}
      value={selectedValue.length === 0 ? undefined : selectedValue}
    />
  );
}

function resolveTextInputValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    return String(value);
  }

  return "";
}

function resolveCheckboxOptionLabel(
  props: WidgetProps<JsonObject, RJSFSchema, SchemaFormContext>,
  option: { label: string; value: unknown },
): string {
  if (option.label !== String(option.value)) {
    return option.label;
  }

  const uiEnumNames = props.uiSchema?.["ui:enumNames"];
  const itemsSchema = isRecord(props.schema.items) ? props.schema.items : null;
  if (Array.isArray(uiEnumNames) && itemsSchema !== null && Array.isArray(itemsSchema.enum)) {
    const optionIndex = itemsSchema.enum.findIndex(
      (candidate: unknown) => candidate === option.value,
    );
    const optionLabel = uiEnumNames[optionIndex];
    if (typeof optionLabel === "string") {
      return optionLabel;
    }
  }

  if (itemsSchema !== null && Array.isArray(itemsSchema.oneOf)) {
    for (const candidate of itemsSchema.oneOf) {
      if (!isRecord(candidate)) {
        continue;
      }

      if (candidate.const === option.value && typeof candidate.title === "string") {
        return candidate.title;
      }
    }
  }

  return option.label;
}

function TextWidget(
  props: WidgetProps<JsonObject, RJSFSchema, SchemaFormContext>,
): React.JSX.Element {
  const value = resolveTextInputValue(props.value);

  return (
    <Input
      aria-label={props.label}
      autoFocus={props.autofocus}
      className="w-full"
      disabled={props.disabled || props.readonly}
      id={props.id}
      onBlur={(event) => {
        props.onBlur(props.id, event.currentTarget.value);
      }}
      onChange={(event) => {
        const nextValue = event.currentTarget.value;
        props.onChange(nextValue.length === 0 ? undefined : nextValue);
      }}
      onFocus={(event) => {
        props.onFocus(props.id, event.currentTarget.value);
      }}
      placeholder={props.placeholder}
      type="text"
      value={value}
    />
  );
}

function EmailWidget(
  props: WidgetProps<JsonObject, RJSFSchema, SchemaFormContext>,
): React.JSX.Element {
  const value = resolveTextInputValue(props.value);

  return (
    <Input
      aria-label={props.label}
      autoFocus={props.autofocus}
      className="w-full"
      disabled={props.disabled || props.readonly}
      id={props.id}
      onBlur={(event) => {
        props.onBlur(props.id, event.currentTarget.value);
      }}
      onChange={(event) => {
        const nextValue = event.currentTarget.value;
        props.onChange(nextValue.length === 0 ? undefined : nextValue);
      }}
      onFocus={(event) => {
        props.onFocus(props.id, event.currentTarget.value);
      }}
      placeholder={props.placeholder}
      type="email"
      value={value}
    />
  );
}

function URLWidget(
  props: WidgetProps<JsonObject, RJSFSchema, SchemaFormContext>,
): React.JSX.Element {
  const value = resolveTextInputValue(props.value);

  return (
    <Input
      aria-label={props.label}
      autoFocus={props.autofocus}
      className="w-full"
      disabled={props.disabled || props.readonly}
      id={props.id}
      onBlur={(event) => {
        props.onBlur(props.id, event.currentTarget.value);
      }}
      onChange={(event) => {
        const nextValue = event.currentTarget.value;
        props.onChange(nextValue.length === 0 ? undefined : nextValue);
      }}
      onFocus={(event) => {
        props.onFocus(props.id, event.currentTarget.value);
      }}
      placeholder={props.placeholder}
      type="url"
      value={value}
    />
  );
}

function resolveAffixedTextWidgetOptions(
  props: WidgetProps<JsonObject, RJSFSchema, SchemaFormContext>,
): {
  prefix: string;
  suffix: string;
  transform: "lowercase" | undefined;
} {
  if (typeof props.options.prefix !== "string" || typeof props.options.suffix !== "string") {
    throw new Error("Affixed text widget requires string prefix and suffix options.");
  }

  if (props.options.transform !== undefined && props.options.transform !== "lowercase") {
    throw new Error("Affixed text widget supports only the lowercase transform option.");
  }

  return {
    prefix: props.options.prefix,
    suffix: props.options.suffix,
    transform: props.options.transform,
  };
}

function resolveAffixedTextInputValue(input: {
  prefix: string;
  suffix: string;
  value: unknown;
}): string {
  const { prefix, suffix, value } = input;
  if (typeof value !== "string" || value.length === 0) {
    return "";
  }

  if (value.startsWith(prefix) && value.endsWith(suffix)) {
    return value.slice(prefix.length, suffix.length === 0 ? undefined : -suffix.length);
  }

  const slashTerminatedSuffix = `${suffix}/`;
  if (suffix.length > 0 && value.startsWith(prefix) && value.endsWith(slashTerminatedSuffix)) {
    return value.slice(prefix.length, -slashTerminatedSuffix.length);
  }

  return value;
}

function buildAffixedTextValue(input: {
  prefix: string;
  suffix: string;
  text: string;
  transform: "lowercase" | undefined;
}): string | undefined {
  const trimmedText = resolveAffixedTextInputValue({
    prefix: input.prefix,
    suffix: input.suffix,
    value: input.text.trim(),
  }).trim();
  if (trimmedText.length === 0) {
    return undefined;
  }

  const normalizedText = input.transform === "lowercase" ? trimmedText.toLowerCase() : trimmedText;
  return `${input.prefix}${normalizedText}${input.suffix}`;
}

function AffixedTextWidget(
  props: WidgetProps<JsonObject, RJSFSchema, SchemaFormContext>,
): React.JSX.Element {
  const { prefix, suffix, transform } = resolveAffixedTextWidgetOptions(props);
  const value = resolveAffixedTextInputValue({
    prefix,
    suffix,
    value: props.value,
  });

  function buildValue(text: string): string | undefined {
    return buildAffixedTextValue({
      prefix,
      suffix,
      text,
      transform,
    });
  }

  return (
    <InputGroup>
      {prefix.length > 0 ? (
        <InputGroupAddon align="inline-start">
          <InputGroupText>{prefix}</InputGroupText>
        </InputGroupAddon>
      ) : null}
      <InputGroupInput
        aria-label={props.label}
        autoFocus={props.autofocus}
        disabled={props.disabled || props.readonly}
        id={props.id}
        onBlur={(event) => {
          props.onBlur(props.id, buildValue(event.currentTarget.value));
        }}
        onChange={(event) => {
          props.onChange(buildValue(event.currentTarget.value));
        }}
        onFocus={(event) => {
          props.onFocus(props.id, buildValue(event.currentTarget.value));
        }}
        placeholder={props.placeholder}
        type="text"
        value={value}
      />
      {suffix.length > 0 ? (
        <InputGroupAddon align="inline-end">
          <InputGroupText>{suffix}</InputGroupText>
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  );
}

function PasswordWidget(
  props: WidgetProps<JsonObject, RJSFSchema, SchemaFormContext>,
): React.JSX.Element {
  const value = resolveTextInputValue(props.value);

  return (
    <Input
      aria-label={props.label}
      autoFocus={props.autofocus}
      className="w-full"
      disabled={props.disabled || props.readonly}
      id={props.id}
      onBlur={(event) => {
        props.onBlur(props.id, event.currentTarget.value);
      }}
      onChange={(event) => {
        const nextValue = event.currentTarget.value;
        props.onChange(nextValue.length === 0 ? undefined : nextValue);
      }}
      onFocus={(event) => {
        props.onFocus(props.id, event.currentTarget.value);
      }}
      placeholder={props.placeholder}
      type="password"
      value={value}
    />
  );
}

function SelectWidget(
  props: WidgetProps<JsonObject, RJSFSchema, SchemaFormContext>,
): React.JSX.Element {
  const enumOptions = props.options.enumOptions ?? [];
  const selectedValue = typeof props.value === "string" ? props.value : undefined;
  const selectedOptionLabel = enumOptions.find(
    (option) => String(option.value) === selectedValue,
  )?.label;
  const { fitContent } = resolveSelectWidgetOptions({
    options: props.options,
    formContext: props.registry.formContext,
  });
  const placeholder =
    typeof props.placeholder === "string"
      ? props.placeholder
      : typeof props.label === "string" && props.label.length > 0
        ? `Select ${props.label.toLowerCase()}`
        : "Select an option";

  return (
    <Select
      disabled={props.disabled || props.readonly}
      onValueChange={(nextValue) => {
        props.onChange(nextValue);
      }}
      value={selectedValue}
    >
      <div className={fitContent ? "md:flex md:justify-end" : undefined}>
        <SelectTrigger
          aria-label={props.label}
          className={fitContent ? "w-full md:w-auto md:min-w-fit md:max-w-full" : "w-full"}
          id={props.id}
        >
          <SelectValue placeholder={placeholder}>{selectedOptionLabel}</SelectValue>
        </SelectTrigger>
      </div>
      <SelectContent
        align={fitContent ? "end" : "center"}
        alignItemWithTrigger={!fitContent}
        className={SchemaFormSelectContentClassName}
      >
        {enumOptions.map((option) => {
          const optionValue = String(option.value);
          return (
            <SelectItem key={optionValue} value={optionValue}>
              {option.label}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

function CheckboxesWidget(
  props: WidgetProps<JsonObject, RJSFSchema, SchemaFormContext>,
): React.JSX.Element {
  const {
    autofocus = false,
    disabled,
    htmlName,
    id,
    onBlur,
    onChange,
    onFocus,
    options: { emptyValue, enumDisabled, enumOptions, inline = false },
    readonly,
  } = props;
  const values = Array.isArray(props.value) ? props.value : [props.value];

  return (
    <div
      data-slot="checkbox-group"
      className={cn(
        "gap-3 flex flex-col",
        inline ? "sm:flex-row sm:flex-wrap sm:gap-4" : undefined,
      )}
      id={id}
    >
      {Array.isArray(enumOptions)
        ? enumOptions.map((option, index) => {
            const checked = enumOptionsIsSelected(option.value, values);
            const itemDisabled = Array.isArray(enumDisabled) && enumDisabled.includes(option.value);
            const itemId = optionId(id, index);
            const describedBy = ariaDescribedByIds(id);
            const optionLabel = resolveCheckboxOptionLabel(props, {
              label: String(option.label),
              value: option.value,
            });

            return (
              <label
                className={cn(
                  "gap-2 flex items-center",
                  disabled || itemDisabled || readonly ? "opacity-50" : undefined,
                )}
                key={itemId}
              >
                <Checkbox
                  aria-describedby={describedBy}
                  autoFocus={autofocus && index === 0}
                  checked={checked}
                  disabled={disabled || itemDisabled || readonly}
                  id={itemId}
                  name={htmlName ?? id}
                  onBlur={() => {
                    onBlur(id, enumOptionsValueForIndex(String(index), enumOptions, emptyValue));
                  }}
                  onCheckedChange={(nextChecked) => {
                    if (nextChecked) {
                      onChange(enumOptionsSelectValue(index, values, enumOptions));
                      return;
                    }

                    onChange(enumOptionsDeselectValue(index, values, enumOptions));
                  }}
                  onFocus={() => {
                    onFocus(id, enumOptionsValueForIndex(String(index), enumOptions, emptyValue));
                  }}
                  value={String(index)}
                />
                <span className="text-sm">{optionLabel}</span>
              </label>
            );
          })
        : null}
    </div>
  );
}

function resolveTextareaWidgetOptions(
  options: WidgetProps<JsonObject, RJSFSchema, SchemaFormContext>["options"],
): {
  placeholder: string | undefined;
  rows: number | undefined;
} {
  const placeholder = typeof options.placeholder === "string" ? options.placeholder : undefined;
  const rows = typeof options.rows === "number" ? options.rows : undefined;

  return {
    placeholder,
    rows,
  };
}

function TextareaWidget(
  props: WidgetProps<JsonObject, RJSFSchema, SchemaFormContext>,
): React.JSX.Element {
  const { placeholder, rows } = resolveTextareaWidgetOptions(props.options);
  const value = typeof props.value === "string" ? props.value : "";

  return (
    <Textarea
      aria-label={props.label}
      autoFocus={props.autofocus}
      className="min-h-28 w-full resize-y"
      disabled={props.disabled || props.readonly}
      id={props.id}
      onBlur={(event) => {
        props.onBlur(props.id, event.currentTarget.value);
      }}
      onChange={(event) => {
        const nextValue = event.currentTarget.value;
        props.onChange(nextValue.trim().length === 0 ? undefined : nextValue);
      }}
      onFocus={(event) => {
        props.onFocus(props.id, event.currentTarget.value);
      }}
      placeholder={placeholder}
      rows={rows}
      value={value}
    />
  );
}

function resolveFormLayout(input: SchemaFormContext | undefined): "vertical" | "horizontal" {
  return input?.layout === "horizontal" ? "horizontal" : "vertical";
}

function resolveFormColumns(input: SchemaFormContext | undefined): 1 | 2 {
  return input?.columns === 2 ? 2 : 1;
}

function resolveLabelTone(input: SchemaFormContext | undefined): "default" | "detail" {
  return input?.labelTone === "detail" ? "detail" : "default";
}

function resolveUiWidget(uiSchema: unknown): string | undefined {
  if (!isRecord(uiSchema)) {
    return undefined;
  }

  const widget = uiSchema["ui:widget"];
  return typeof widget === "string" ? widget : undefined;
}

function SchemaFormDescriptionFieldTemplate(
  props: DescriptionFieldProps<JsonObject, RJSFSchema, SchemaFormContext>,
): React.JSX.Element | null {
  if (
    (typeof props.description === "string" && props.description.length === 0) ||
    props.description === undefined
  ) {
    return null;
  }

  return null;
}

function SchemaFormFieldHelpTemplate(
  props: FieldHelpProps<JsonObject, RJSFSchema, SchemaFormContext>,
): React.JSX.Element | null {
  if ((typeof props.help === "string" && props.help.length === 0) || props.help === undefined) {
    return null;
  }

  return <p className="text-muted-foreground text-sm">{props.help}</p>;
}

function SchemaFormFieldErrorTemplate(
  props: FieldErrorProps<JsonObject, RJSFSchema, SchemaFormContext>,
): React.JSX.Element | null {
  const stringErrors = (props.errors ?? []).filter(
    (message): message is string => typeof message === "string",
  );
  if (stringErrors.length === 0) {
    return null;
  }

  return <FieldError errors={stringErrors.map((message) => ({ message }))} />;
}

function resolveFieldLayout(
  props: FieldTemplateProps<JsonObject, RJSFSchema, SchemaFormContext>,
): SchemaFormFieldLayout {
  const formLayout = resolveFormLayout(props.registry.formContext);
  if (formLayout === "vertical") {
    return "vertical";
  }

  if (!isRecord(props.uiSchema)) {
    return "horizontal";
  }

  const options = props.uiSchema["ui:options"];
  if (!isRecord(options)) {
    return "horizontal";
  }

  // Repo-specific contract for schema-driven forms:
  // - `formContext.layout` sets the default field orientation
  // - `ui:options.layout = "stacked"` opts a field back into vertical
  //   presentation inside a horizontal form
  return options.layout === "stacked" ? "vertical" : "horizontal";
}

function isObjectSchema(schema: unknown): boolean {
  if (isRecord(schema) && schema.type === "object") {
    return true;
  }

  return isRecord(schema) && isRecord(schema.properties);
}

function resolveSchemaProperties(schema: unknown): Record<string, unknown> {
  if (!isRecord(schema)) {
    return {};
  }

  const properties = schema.properties;
  return isRecord(properties) ? properties : {};
}

function resolveObjectPropertyUiSchema(uiSchema: unknown, propertyName: string): unknown {
  if (!isRecord(uiSchema)) {
    return undefined;
  }

  return uiSchema[propertyName];
}

function hasRenderableSchemaContent(input: { schema: unknown; uiSchema: unknown }): boolean {
  if (isRecord(input.uiSchema) && input.uiSchema["ui:widget"] === "hidden") {
    return false;
  }

  if (!isRecord(input.schema)) {
    return true;
  }

  const propertySchemas = resolveSchemaProperties(input.schema);
  const propertyNames = Object.keys(propertySchemas);
  if (propertyNames.length === 0) {
    return true;
  }

  return propertyNames.some((propertyName) =>
    hasRenderableSchemaContent({
      schema: propertySchemas[propertyName],
      uiSchema: resolveObjectPropertyUiSchema(input.uiSchema, propertyName),
    }),
  );
}

function isFlattenableObjectWrapper(input: {
  schema: unknown;
  uiSchema: unknown;
  isRootObject: boolean;
}): boolean {
  if (input.isRootObject || !isObjectSchema(input.schema)) {
    return false;
  }

  const schemaRecord = isRecord(input.schema) ? input.schema : {};
  const title =
    typeof schemaRecord.title === "string" && schemaRecord.title.length > 0
      ? schemaRecord.title
      : "";
  const description =
    typeof schemaRecord.description === "string" && schemaRecord.description.length > 0
      ? schemaRecord.description
      : undefined;
  const propertySchemas = resolveSchemaProperties(input.schema);
  const propertyNames = Object.keys(propertySchemas);

  if (title.length > 0 || description !== undefined || propertyNames.length === 0) {
    return false;
  }

  return propertyNames.some((propertyName) =>
    hasRenderableSchemaContent({
      schema: propertySchemas[propertyName],
      uiSchema: resolveObjectPropertyUiSchema(input.uiSchema, propertyName),
    }),
  );
}

function shouldSpanFullWidth(input: {
  layout: SchemaFormFieldLayout;
  formContext: SchemaFormContext | undefined;
  schema: unknown;
  uiSchema: unknown;
}): boolean {
  if (input.layout !== "vertical" || resolveFormColumns(input.formContext) !== 2) {
    return false;
  }

  const widget = resolveUiWidget(input.uiSchema);
  if (
    widget === "textarea" ||
    widget === "TextareaWidget" ||
    widget === "integration-resource-picker"
  ) {
    return true;
  }

  return isRecord(input.schema) && input.schema.type === "array";
}

function SchemaFormFieldTemplate(
  props: FieldTemplateProps<JsonObject, RJSFSchema, SchemaFormContext>,
): React.JSX.Element {
  if (props.hidden) {
    return props.children;
  }

  // Let object nodes render through the object template directly so structural
  // containers with only hidden descendants do not leave behind empty field shells.
  if (isObjectSchema(props.schema)) {
    return props.children;
  }

  const layout = resolveFieldLayout(props);
  const hasErrors = (props.rawErrors ?? []).length > 0;
  const labelTone = resolveLabelTone(props.registry.formContext);
  const useDetailLabel = labelTone === "detail" && layout === "vertical";
  const rawDescription =
    typeof props.rawDescription === "string" && props.rawDescription.length > 0
      ? props.rawDescription
      : null;
  const useFullWidth = shouldSpanFullWidth({
    layout,
    formContext: props.registry.formContext,
    schema: props.schema,
    uiSchema: props.uiSchema,
  });

  return (
    <Field
      className={cn(
        props.classNames,
        layout === "horizontal" ? "gap-2" : undefined,
        useFullWidth ? "md:col-span-2" : undefined,
      )}
      contentWidth={layout === "horizontal" ? "fill" : undefined}
      data-invalid={hasErrors || undefined}
      orientation={layout}
      style={props.style}
    >
      {props.displayLabel && props.label.length > 0 ? (
        <FieldHeader>
          {rawDescription === null ? (
            useDetailLabel ? (
              <DetailLabel as="p">{props.label}</DetailLabel>
            ) : (
              <FieldLabel
                htmlFor={props.id}
                {...(props.required === true ? { required: true } : {})}
              >
                {props.label}
              </FieldLabel>
            )
          ) : useDetailLabel ? (
            <DetailLabelWithTooltip
              as="p"
              tooltip={rawDescription}
              tooltipLabel="Field description"
            >
              {props.label}
            </DetailLabelWithTooltip>
          ) : (
            <FieldLabelWithTooltip
              htmlFor={props.id}
              {...(props.required === true ? { required: true } : {})}
              tooltip={rawDescription}
              tooltipLabel="Field description"
            >
              {props.label}
            </FieldLabelWithTooltip>
          )}
        </FieldHeader>
      ) : null}
      <FieldContent>
        {props.children}
        {props.hideError ? null : props.errors}
        {props.help}
      </FieldContent>
    </Field>
  );
}

function SchemaFormObjectHeader(input: {
  description: string | undefined;
  title: string;
}): React.JSX.Element | null {
  if (input.title.length === 0 && input.description === undefined) {
    return null;
  }

  if (input.title.length === 0) {
    return (
      <DetailLabelWithTooltip as="p" tooltip={input.description} tooltipLabel="Field description">
        Description
      </DetailLabelWithTooltip>
    );
  }

  if (input.description === undefined) {
    return <FieldTitle>{input.title}</FieldTitle>;
  }

  return (
    <FieldTitleWithTooltip tooltip={input.description} tooltipLabel="Field description">
      {input.title}
    </FieldTitleWithTooltip>
  );
}

function SchemaFormObjectFieldTemplate(
  props: ObjectFieldTemplateProps<JsonObject, RJSFSchema, SchemaFormContext>,
): React.JSX.Element {
  const layout = resolveFormLayout(props.registry.formContext);
  const columns = resolveFormColumns(props.registry.formContext);
  const visibleProperties = props.properties.filter((property) => !property.hidden);
  const hiddenProperties = props.properties.filter((property) => property.hidden);
  const schemaProperties = resolveSchemaProperties(props.schema);
  const title =
    typeof props.schema.title === "string" && props.schema.title.length > 0
      ? props.schema.title
      : "";
  const description =
    typeof props.schema.description === "string" && props.schema.description.length > 0
      ? props.schema.description
      : undefined;
  const visibleRenderableProperties = visibleProperties.filter((property) =>
    hasRenderableSchemaContent({
      schema: schemaProperties[property.name],
      uiSchema: resolveObjectPropertyUiSchema(props.uiSchema, property.name),
    }),
  );
  const hiddenOnlyVisibleProperties = visibleProperties.filter(
    (property) =>
      !hasRenderableSchemaContent({
        schema: schemaProperties[property.name],
        uiSchema: resolveObjectPropertyUiSchema(props.uiSchema, property.name),
      }),
  );
  const isRootObject = props.fieldPathId.path.length === 0;
  const shouldFlattenWrapper =
    props.optionalDataControl === undefined &&
    isFlattenableObjectWrapper({
      isRootObject,
      schema: props.schema,
      uiSchema: props.uiSchema,
    });

  if (
    visibleRenderableProperties.length === 0 &&
    hiddenOnlyVisibleProperties.length === 0 &&
    description === undefined &&
    title.length === 0
  ) {
    return <>{hiddenProperties.map((property) => property.content)}</>;
  }

  if (shouldFlattenWrapper) {
    return (
      <>
        {visibleRenderableProperties.map((property) => property.content)}
        {hiddenOnlyVisibleProperties.map((property) => property.content)}
        {hiddenProperties.map((property) => property.content)}
      </>
    );
  }

  return (
    <>
      <div
        className={cn(
          props.className,
          SchemaFormVerticalFieldGroupClassName,
          layout === "horizontal"
            ? SchemaFormHorizontalFieldGroupClassName
            : columns === 2
              ? "grid gap-x-6 gap-y-4 md:grid-cols-2"
              : undefined,
        )}
      >
        {title.length > 0 || description !== undefined ? (
          <FieldHeader className={columns === 2 ? "md:col-span-2" : undefined}>
            <SchemaFormObjectHeader description={description} title={title} />
          </FieldHeader>
        ) : null}
        {visibleRenderableProperties.map((property) => (
          <div
            className={(() => {
              const propertySchema = schemaProperties[property.name];
              const propertyUiSchema = resolveObjectPropertyUiSchema(props.uiSchema, property.name);
              if (
                isFlattenableObjectWrapper({
                  isRootObject: false,
                  schema: propertySchema,
                  uiSchema: propertyUiSchema,
                })
              ) {
                return "contents";
              }

              return shouldSpanFullWidth({
                layout,
                formContext: props.registry.formContext,
                schema: propertySchema,
                uiSchema: propertyUiSchema,
              })
                ? "md:col-span-2"
                : undefined;
            })()}
            key={property.name}
          >
            {property.content}
          </div>
        ))}
        {props.optionalDataControl}
      </div>
      {hiddenOnlyVisibleProperties.map((property) => property.content)}
      {hiddenProperties.map((property) => property.content)}
    </>
  );
}

export const SchemaFormTemplates = {
  DescriptionFieldTemplate: SchemaFormDescriptionFieldTemplate,
  FieldErrorTemplate: SchemaFormFieldErrorTemplate,
  FieldHelpTemplate: SchemaFormFieldHelpTemplate,
  FieldTemplate: SchemaFormFieldTemplate,
  ObjectFieldTemplate: SchemaFormObjectFieldTemplate,
};

export const SchemaFormWidgets = {
  TextWidget,
  EmailWidget,
  URLWidget,
  PasswordWidget,
  SelectWidget,
  CheckboxesWidget,
  TextareaWidget,
  "affixed-text": AffixedTextWidget,
  checkboxes: CheckboxesWidget,
  "comma-separated-string-array": CommaSeparatedStringArrayWidget,
  "integration-resource-picker": IntegrationResourcePickerWidget,
  "multi-select-string-array-combobox": MultiSelectStringArrayComboboxWidget,
  "single-select-string-combobox": SingleSelectStringComboboxWidget,
};

function HiddenSubmitButton(
  _props: SubmitButtonProps<JsonObject, RJSFSchema, SchemaFormContext>,
): null {
  return null;
}

const SchemaFormTheme = {
  templates: SchemaFormTemplates,
  widgets: SchemaFormWidgets,
};

export const SchemaFormWithoutSubmit = withTheme<JsonObject, RJSFSchema, SchemaFormContext>({
  ...SchemaFormTheme,
  templates: {
    ...SchemaFormTemplates,
    ButtonTemplates: {
      SubmitButton: HiddenSubmitButton,
    },
  },
});
