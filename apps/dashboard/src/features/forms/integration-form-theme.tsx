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
  cn,
} from "@mistle/ui";
import type {
  FieldTemplateProps,
  ObjectFieldTemplateProps,
  RJSFSchema,
  WidgetProps,
} from "@rjsf/utils";

import { IntegrationResourceStringArrayWidget } from "./integration-resource-string-array-widget.js";

type JsonObject = Record<string, unknown>;
type IntegrationFormContext = {
  layout?: "vertical" | "horizontal";
};

function resolveSelectWidgetOptions(
  options: WidgetProps<JsonObject, RJSFSchema, IntegrationFormContext>["options"],
): {
  fitContent: boolean;
} {
  return {
    fitContent: options.fitContent === true,
  };
}

export const IntegrationHorizontalFieldGroupClassName = "gap-6 flex flex-col";
export const IntegrationHorizontalFieldLayoutClassName =
  "w-full items-start gap-4 [&>[data-slot=field-label]]:w-40 [&>[data-slot=field-label]]:shrink-0 [&>[data-slot=field-label]]:pt-2 [&>[data-slot=field-content]]:min-w-0 [&>[data-slot=field-content]]:flex-1";
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
  const { fitContent } = resolveSelectWidgetOptions(props.options);
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
      <div className={fitContent ? "flex justify-end" : undefined}>
        <SelectTrigger
          aria-label={props.label}
          className={fitContent ? "w-auto min-w-fit max-w-full" : "w-full"}
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

function resolveFormLayout(input: IntegrationFormContext | undefined): "vertical" | "horizontal" {
  return input?.layout === "horizontal" ? "horizontal" : "vertical";
}

function IntegrationFieldTemplate(
  props: FieldTemplateProps<JsonObject, RJSFSchema, IntegrationFormContext>,
): React.JSX.Element {
  if (props.hidden) {
    return props.children;
  }

  const errorItems = (props.rawErrors ?? []).map((message) => ({ message }));
  const layout = resolveFormLayout(props.registry.formContext);

  return (
    <Field
      className={cn(
        props.classNames,
        layout === "horizontal" ? IntegrationHorizontalFieldLayoutClassName : undefined,
      )}
      data-invalid={errorItems.length > 0 || undefined}
      orientation={layout}
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
  "comma-separated-string-array": CommaSeparatedStringArrayWidget,
  "integration-resource-string-array": IntegrationResourceStringArrayWidget,
};
