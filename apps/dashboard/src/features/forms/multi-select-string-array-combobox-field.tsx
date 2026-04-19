import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
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

type MultiSelectStringArrayComboboxFieldProps = {
  emptyMessage?: string;
  inputId: string;
  inputLabel?: string;
  invalid?: boolean;
  onBlur?: (value: readonly string[]) => void;
  onChange: (value: readonly string[]) => void;
  onFocus?: (value: readonly string[]) => void;
  options: readonly StringComboboxOption[];
  placeholder?: string;
  readonly?: boolean | undefined;
  value: readonly string[];
};

export function MultiSelectStringArrayComboboxField(
  props: MultiSelectStringArrayComboboxFieldProps,
): React.JSX.Element {
  const [isOpen, setIsOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const anchorRef = useComboboxAnchor();
  const emptyMessage = props.emptyMessage ?? "No matching options.";
  const filteredOptions = filterStringComboboxOptions(props.options, search);

  if (props.readonly) {
    const selectedLabels = props.value
      .map(
        (selectedValue) =>
          resolveStringComboboxOption(props.options, selectedValue)?.label ?? selectedValue,
      )
      .join(", ");

    return <Input disabled id={props.inputId} value={selectedLabels} />;
  }

  return (
    <Combobox<string, true>
      autoHighlight
      inputValue={search}
      multiple
      onInputValueChange={setSearch}
      onOpenChange={(open) => {
        setIsOpen(open);
        if (!open) {
          setSearch("");
          props.onBlur?.(props.value);
        }
      }}
      onValueChange={(value) => {
        props.onChange(value);
      }}
      open={isOpen}
      value={[...props.value]}
    >
      <div ref={anchorRef}>
        <ComboboxChips
          aria-invalid={props.invalid ? true : undefined}
          onClick={() => {
            setIsOpen(true);
          }}
        >
          {props.value.map((selectedValue) => {
            const optionLabel =
              resolveStringComboboxOption(props.options, selectedValue)?.label ?? selectedValue;

            return <ComboboxChip key={selectedValue}>{optionLabel}</ComboboxChip>;
          })}
          <ComboboxChipsInput
            aria-label={props.inputLabel}
            className="min-w-28"
            id={props.inputId}
            onFocus={() => {
              setIsOpen(true);
              props.onFocus?.(props.value);
            }}
            placeholder={props.value.length === 0 ? props.placeholder : "Search"}
          />
        </ComboboxChips>
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
