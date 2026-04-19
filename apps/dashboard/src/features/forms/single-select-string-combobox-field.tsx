import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  Input,
  useComboboxAnchor,
} from "@mistle/ui";
import * as React from "react";

import {
  filterStringComboboxOptions,
  resolveStringComboboxOption,
  type StringComboboxOption,
} from "./string-combobox-options.js";

type SingleSelectStringComboboxFieldProps = {
  emptyMessage?: string;
  inputId: string;
  inputLabel?: string;
  invalid?: boolean;
  onBlur?: (value: string | undefined) => void;
  onChange: (value: string | undefined) => void;
  onFocus?: (value: string | undefined) => void;
  options: readonly StringComboboxOption[];
  placeholder: string;
  readonly?: boolean | undefined;
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
      <div className="w-full" ref={anchorRef}>
        <ComboboxInput
          aria-invalid={props.invalid ? true : undefined}
          aria-label={props.inputLabel}
          className="w-full"
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
          showClear={selectedValue.length > 0}
        />
      </div>
      {isOpen ? (
        <ComboboxContent anchor={anchorRef} className="p-0">
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
