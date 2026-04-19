import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  Input,
  cn,
  useComboboxAnchor,
} from "@mistle/ui";
import * as React from "react";

import {
  filterStringComboboxOptions,
  resolveStringComboboxOption,
  type StringComboboxOption,
} from "./string-combobox-options.js";

type SingleSelectStringComboboxFieldProps = {
  contentClassName?: string;
  disabled?: boolean;
  emptyMessage?: string;
  inputId: string;
  inputLabel?: string;
  inputWrapperClassName?: string;
  invalid?: boolean;
  onBlur?: (value: string | undefined) => void;
  onChange: (value: string | undefined) => void;
  onFocus?: (value: string | undefined) => void;
  options: readonly StringComboboxOption[];
  placeholder: string;
  readonly?: boolean | undefined;
  showClear?: boolean;
  value: string | undefined;
};

export function SingleSelectStringComboboxField(
  props: SingleSelectStringComboboxFieldProps,
): React.JSX.Element {
  const selectedValue = typeof props.value === "string" ? props.value : "";
  const selectedOption = resolveStringComboboxOption(props.options, selectedValue);
  const [isOpen, setIsOpen] = React.useState(false);
  const [queryText, setQueryText] = React.useState(selectedOption?.label ?? "");
  const anchorRef = useComboboxAnchor();
  const emptyMessage = props.emptyMessage ?? "No matching options.";
  const disabled = props.disabled ?? false;
  const showClear = props.showClear ?? selectedValue.length > 0;

  React.useEffect(() => {
    if (isOpen) {
      return;
    }

    setQueryText(selectedOption?.label ?? "");
  }, [isOpen, selectedOption?.label]);

  const filteredOptions = filterStringComboboxOptions(props.options, queryText);

  if (props.readonly) {
    return <Input disabled id={props.inputId} value={selectedOption?.label ?? selectedValue} />;
  }

  return (
    <Combobox<string>
      autoHighlight
      disabled={disabled}
      inputValue={queryText}
      onInputValueChange={setQueryText}
      onOpenChange={(open) => {
        setIsOpen(open);
        if (open) {
          setQueryText("");
        } else {
          setQueryText(selectedOption?.label ?? "");
        }
      }}
      onValueChange={(value) => {
        const nextSelectedOption =
          value === null ? undefined : resolveStringComboboxOption(props.options, value);
        setQueryText(nextSelectedOption?.label ?? "");
        props.onChange(value ?? undefined);
      }}
      open={isOpen}
      value={selectedValue.length === 0 ? null : selectedValue}
    >
      <div className={cn("w-full", props.inputWrapperClassName)} ref={anchorRef}>
        <ComboboxInput
          aria-invalid={props.invalid ? true : undefined}
          aria-label={props.inputLabel}
          className="w-full"
          disabled={disabled}
          id={props.inputId}
          onBlur={() => {
            setIsOpen(false);
            props.onBlur?.(selectedValue.length === 0 ? undefined : selectedValue);
          }}
          onFocus={() => {
            setQueryText("");
            setIsOpen(true);
            props.onFocus?.(selectedValue.length === 0 ? undefined : selectedValue);
          }}
          placeholder={props.placeholder}
          showClear={showClear}
        />
      </div>
      {isOpen ? (
        <ComboboxContent anchor={anchorRef} className={cn("p-0", props.contentClassName)}>
          <ComboboxList>
            {filteredOptions.map((option) => (
              <ComboboxItem key={option.value} value={option.value}>
                <span className="truncate">{option.label}</span>
              </ComboboxItem>
            ))}
            {filteredOptions.length === 0 ? (
              <div className="text-muted-foreground py-2 text-center text-sm">{emptyMessage}</div>
            ) : null}
          </ComboboxList>
        </ComboboxContent>
      ) : null}
    </Combobox>
  );
}
