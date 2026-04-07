import {
  Checkbox,
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldHeader,
  FieldLabel,
  FieldTitle,
  Input,
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

import { isRecord } from "../shared/is-record.js";
import type { IntegrationFormContext } from "./integration-form-context.js";
import { IntegrationResourceStringArrayWidget } from "./integration-resource-string-array-widget.js";

type JsonObject = Record<string, unknown>;
type IntegrationFieldLayout = "horizontal" | "vertical";

function resolveSelectWidgetOptions(input: {
  options: WidgetProps<JsonObject, RJSFSchema, IntegrationFormContext>["options"];
  formContext: IntegrationFormContext | undefined;
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

export const IntegrationHorizontalFieldGroupClassName = "gap-6 flex flex-col";
export const IntegrationSelectContentClassName =
  "w-max min-w-(--anchor-width) max-w-[min(32rem,calc(100vw-2rem))]";

function resolveCommaSeparatedOptions(
  options: WidgetProps<JsonObject, RJSFSchema, IntegrationFormContext>["options"],
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

function CommaSeparatedStringArrayWidget(
  props: WidgetProps<JsonObject, RJSFSchema, IntegrationFormContext>,
): React.JSX.Element {
  const { delimiter, placeholder } = resolveCommaSeparatedOptions(props.options);
  const value = Array.isArray(props.value)
    ? props.value.filter((entry): entry is string => typeof entry === "string")
    : [];

  return (
    <Input
      aria-label={props.label}
      className="w-full"
      disabled={props.disabled || props.readonly}
      id={props.id}
      onBlur={() => {
        props.onBlur(props.id, value);
      }}
      onChange={(event) => {
        const nextValue = event.currentTarget.value
          .split(delimiter)
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0);
        props.onChange(nextValue);
      }}
      onFocus={() => {
        props.onFocus(props.id, value);
      }}
      placeholder={placeholder}
      value={value.join(`${delimiter} `)}
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

function TextWidget(
  props: WidgetProps<JsonObject, RJSFSchema, IntegrationFormContext>,
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

function PasswordWidget(
  props: WidgetProps<JsonObject, RJSFSchema, IntegrationFormContext>,
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
  props: WidgetProps<JsonObject, RJSFSchema, IntegrationFormContext>,
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
        className={IntegrationSelectContentClassName}
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
  props: WidgetProps<JsonObject, RJSFSchema, IntegrationFormContext>,
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
                  aria-label={String(option.label)}
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
                <span className="text-sm">{option.label}</span>
              </label>
            );
          })
        : null}
    </div>
  );
}

function resolveTextareaWidgetOptions(
  options: WidgetProps<JsonObject, RJSFSchema, IntegrationFormContext>["options"],
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
  props: WidgetProps<JsonObject, RJSFSchema, IntegrationFormContext>,
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

function resolveFormLayout(input: IntegrationFormContext | undefined): "vertical" | "horizontal" {
  return input?.layout === "horizontal" ? "horizontal" : "vertical";
}

function IntegrationDescriptionFieldTemplate(
  props: DescriptionFieldProps<JsonObject, RJSFSchema, IntegrationFormContext>,
): React.JSX.Element | null {
  if (
    (typeof props.description === "string" && props.description.length === 0) ||
    props.description === undefined
  ) {
    return null;
  }

  return <FieldDescription id={props.id}>{props.description}</FieldDescription>;
}

function IntegrationFieldHelpTemplate(
  props: FieldHelpProps<JsonObject, RJSFSchema, IntegrationFormContext>,
): React.JSX.Element | null {
  if ((typeof props.help === "string" && props.help.length === 0) || props.help === undefined) {
    return null;
  }

  return <FieldDescription>{props.help}</FieldDescription>;
}

function IntegrationFieldErrorTemplate(
  props: FieldErrorProps<JsonObject, RJSFSchema, IntegrationFormContext>,
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
  props: FieldTemplateProps<JsonObject, RJSFSchema, IntegrationFormContext>,
): IntegrationFieldLayout {
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

function isObjectSchema(schema: RJSFSchema): boolean {
  if (schema.type === "object") {
    return true;
  }

  return isRecord(schema.properties);
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

function IntegrationFieldTemplate(
  props: FieldTemplateProps<JsonObject, RJSFSchema, IntegrationFormContext>,
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

  return (
    <Field
      className={cn(props.classNames, layout === "horizontal" ? "gap-2" : undefined)}
      contentWidth={layout === "horizontal" ? "fill" : undefined}
      data-invalid={hasErrors || undefined}
      orientation={layout}
      style={props.style}
    >
      {props.displayLabel && props.label.length > 0 ? (
        <FieldHeader>
          <FieldLabel htmlFor={props.id}>
            {props.label}
            {props.required ? <span className="text-destructive">*</span> : null}
          </FieldLabel>
          {props.description}
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

function IntegrationObjectFieldTemplate(
  props: ObjectFieldTemplateProps<JsonObject, RJSFSchema, IntegrationFormContext>,
): React.JSX.Element {
  const layout = resolveFormLayout(props.registry.formContext);
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

  if (
    visibleRenderableProperties.length === 0 &&
    hiddenOnlyVisibleProperties.length === 0 &&
    description === undefined &&
    title.length === 0
  ) {
    return <>{hiddenProperties.map((property) => property.content)}</>;
  }

  return (
    <>
      <div
        className={cn(
          props.className,
          layout === "horizontal" ? IntegrationHorizontalFieldGroupClassName : undefined,
        )}
      >
        {title.length > 0 || description !== undefined ? (
          <FieldHeader>
            {title.length > 0 ? <FieldTitle>{title}</FieldTitle> : null}
            {description !== undefined ? <FieldDescription>{description}</FieldDescription> : null}
          </FieldHeader>
        ) : null}
        {visibleRenderableProperties.map((property) => (
          <div key={property.name}>{property.content}</div>
        ))}
        {props.optionalDataControl}
      </div>
      {hiddenOnlyVisibleProperties.map((property) => property.content)}
      {hiddenProperties.map((property) => property.content)}
    </>
  );
}

export const IntegrationFormTemplates = {
  DescriptionFieldTemplate: IntegrationDescriptionFieldTemplate,
  FieldErrorTemplate: IntegrationFieldErrorTemplate,
  FieldHelpTemplate: IntegrationFieldHelpTemplate,
  FieldTemplate: IntegrationFieldTemplate,
  ObjectFieldTemplate: IntegrationObjectFieldTemplate,
};

export const IntegrationFormWidgets = {
  TextWidget,
  PasswordWidget,
  SelectWidget,
  CheckboxesWidget,
  TextareaWidget,
  checkboxes: CheckboxesWidget,
  "comma-separated-string-array": CommaSeparatedStringArrayWidget,
  "integration-resource-string-array": IntegrationResourceStringArrayWidget,
};

function HiddenSubmitButton(
  _props: SubmitButtonProps<JsonObject, RJSFSchema, IntegrationFormContext>,
): null {
  return null;
}

const IntegrationTheme = {
  templates: IntegrationFormTemplates,
  widgets: IntegrationFormWidgets,
};

export const IntegrationFormWithoutSubmit = withTheme<
  JsonObject,
  RJSFSchema,
  IntegrationFormContext
>({
  ...IntegrationTheme,
  templates: {
    ...IntegrationFormTemplates,
    ButtonTemplates: {
      SubmitButton: HiddenSubmitButton,
    },
  },
});
