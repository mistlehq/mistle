export type StringComboboxOption = {
  label: string;
  value: string;
};

export function filterStringComboboxOptions(
  options: readonly StringComboboxOption[],
  query: string,
): readonly StringComboboxOption[] {
  const normalizedSearch = query.trim().toLowerCase();
  if (normalizedSearch.length === 0) {
    return options;
  }

  return options.filter(
    (option) =>
      option.label.toLowerCase().includes(normalizedSearch) ||
      option.value.toLowerCase().includes(normalizedSearch),
  );
}

export function resolveStringComboboxOption(
  options: readonly StringComboboxOption[],
  value: string,
): StringComboboxOption | undefined {
  return options.find((option) => option.value === value);
}
