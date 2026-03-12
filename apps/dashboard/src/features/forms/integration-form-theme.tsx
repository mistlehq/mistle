import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
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
import type {
  FieldTemplateProps,
  ObjectFieldTemplateProps,
  RJSFSchema,
  WidgetProps,
} from "@rjsf/utils";

import type { IntegrationFormContext } from "./integration-form-context.js";
import { IntegrationResourceStringArrayWidget } from "./integration-resource-string-array-widget.js";

type JsonObject = Record<string, unknown>;
type IntegrationFieldLayout = "horizontal" | "vertical";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
export const IntegrationHorizontalFieldLayoutClassName =
  "w-full gap-2 md:flex-row md:items-start md:gap-4 md:[&>*]:w-auto md:[&>[data-slot=field-label]]:w-40 md:[&>[data-slot=field-label]]:shrink-0 md:[&>[data-slot=field-label]]:pt-2 md:[&>[data-slot=field-content]]:min-w-0 md:[&>[data-slot=field-content]]:w-auto md:[&>[data-slot=field-content]]:flex-1";
export const IntegrationStackedFieldLayoutClassName =
  "w-full gap-1 [&>[data-slot=field-content]]:gap-2";
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

function SelectWidget(props: WidgetProps<JsonObject, RJSFSchema>): React.JSX.Element {
  const enumOptions = props.options.enumOptions ?? [];
  const selectedValue = typeof props.value === "string" ? props.value : undefined;
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
          <SelectValue placeholder={placeholder} />
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

  return options.layout === "stacked" ? "vertical" : "horizontal";
}

function IntegrationFieldTemplate(
  props: FieldTemplateProps<JsonObject, RJSFSchema, IntegrationFormContext>,
): React.JSX.Element {
  if (props.hidden) {
    return props.children;
  }

  const errorItems = (props.rawErrors ?? []).map((message) => ({ message }));
  const layout = resolveFieldLayout(props);

  return (
    <Field
      className={cn(
        props.classNames,
        layout === "horizontal"
          ? IntegrationHorizontalFieldLayoutClassName
          : IntegrationStackedFieldLayoutClassName,
      )}
      data-invalid={errorItems.length > 0 || undefined}
      orientation="vertical"
      style={props.style}
    >
      {props.displayLabel && props.label.length > 0 ? (
        <FieldLabel htmlFor={props.id}>
          {props.label}
          {props.required ? <span className="text-destructive">*</span> : null}
        </FieldLabel>
      ) : null}
      <FieldContent>
        {typeof props.rawDescription === "string" && props.rawDescription.length > 0 ? (
          <FieldDescription>{props.rawDescription}</FieldDescription>
        ) : null}
        {props.children}
        <FieldError errors={errorItems} />
        {typeof props.rawHelp === "string" && props.rawHelp.length > 0 ? (
          <FieldDescription>{props.rawHelp}</FieldDescription>
        ) : null}
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

  return (
    <>
      <div
        className={cn(
          props.className,
          layout === "horizontal" ? IntegrationHorizontalFieldGroupClassName : undefined,
        )}
      >
        {props.title.length > 0 ? <FieldTitle>{props.title}</FieldTitle> : null}
        {typeof props.description === "string" ? (
          <FieldDescription>{props.description}</FieldDescription>
        ) : props.description ? (
          props.description
        ) : null}
        {visibleProperties.map((property) => (
          <div key={property.name}>{property.content}</div>
        ))}
        {props.optionalDataControl}
      </div>
      {hiddenProperties.map((property) => property.content)}
    </>
  );
}

export const IntegrationFormTemplates = {
  FieldTemplate: IntegrationFieldTemplate,
  ObjectFieldTemplate: IntegrationObjectFieldTemplate,
};

export const IntegrationFormWidgets = {
  SelectWidget,
  TextareaWidget,
  "comma-separated-string-array": CommaSeparatedStringArrayWidget,
  "integration-resource-string-array": IntegrationResourceStringArrayWidget,
};
