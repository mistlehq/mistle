export function defaultMissingEnabledToFalse(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }

  if ("enabled" in value) {
    return value;
  }

  return {
    ...value,
    enabled: false,
  };
}
