import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from "@mistle/ui";
import type { FieldTemplateProps, RJSFSchema, WidgetProps } from "@rjsf/utils";

type JsonObject = Record<string, unknown>;

function resolveCommaSeparatedOptions(options: WidgetProps<JsonObject, RJSFSchema>["options"]): {
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
  props: WidgetProps<JsonObject, RJSFSchema>,
): React.JSX.Element {
  const { delimiter, placeholder } = resolveCommaSeparatedOptions(props.options);
  const value = Array.isArray(props.value)
    ? props.value.filter((entry): entry is string => typeof entry === "string")
    : [];

  return (
    <Input
      aria-label={props.label}
      className="w-full max-w-80"
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
      <SelectTrigger aria-label={props.label} className="w-full max-w-80" id={props.id}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
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

function IntegrationFieldTemplate(
  props: FieldTemplateProps<JsonObject, RJSFSchema>,
): React.JSX.Element {
  if (props.hidden) {
    return props.children;
  }

  const errorItems = (props.rawErrors ?? []).map((message) => ({ message }));

  return (
    <Field
      className={cn(props.classNames)}
      data-invalid={errorItems.length > 0 || undefined}
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

export const IntegrationFormTemplates = {
  FieldTemplate: IntegrationFieldTemplate,
};

export const IntegrationFormWidgets = {
  SelectWidget,
  "comma-separated-string-array": CommaSeparatedStringArrayWidget,
};
