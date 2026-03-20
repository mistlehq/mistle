export function resolveSelectableValue(input: {
  selectedValue: string | null;
  optionValues: readonly string[];
}): string | null {
  if (input.selectedValue === null) {
    return null;
  }

  return input.optionValues.includes(input.selectedValue) ? input.selectedValue : null;
}
