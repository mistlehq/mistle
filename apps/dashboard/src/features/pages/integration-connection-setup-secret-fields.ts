export function hasConfiguredSetupSecretField(input: {
  configuredSecretNames: readonly string[] | undefined;
  fieldName: string;
}): boolean {
  return input.configuredSecretNames?.includes(input.fieldName) ?? false;
}

export function resolveConfiguredSetupSecretFieldKeys<FieldKey extends string>(input: {
  configuredSecretNames: readonly string[] | undefined;
  fieldKeys: ReadonlyArray<FieldKey>;
}): ReadonlySet<FieldKey> {
  const configuredSecretFieldKeys = new Set<FieldKey>();

  for (const fieldKey of input.fieldKeys) {
    if (
      hasConfiguredSetupSecretField({
        configuredSecretNames: input.configuredSecretNames,
        fieldName: fieldKey,
      })
    ) {
      configuredSecretFieldKeys.add(fieldKey);
    }
  }

  return configuredSecretFieldKeys;
}
