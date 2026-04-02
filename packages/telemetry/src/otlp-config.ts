export function parseOtlpResourceAttributes(input: {
  resourceAttributes: string | undefined;
  serviceName: string;
}): Record<string, string> {
  const attributes: Record<string, string> = {
    "service.name": input.serviceName,
  };

  const rawResourceAttributes = input.resourceAttributes?.trim();
  if (rawResourceAttributes === undefined || rawResourceAttributes.length === 0) {
    return attributes;
  }

  for (const rawEntry of rawResourceAttributes.split(",")) {
    const entry = rawEntry.trim();
    if (entry.length === 0) {
      continue;
    }

    const equalsIndex = entry.indexOf("=");
    if (equalsIndex <= 0) {
      throw new Error(`Invalid OTEL resource attribute '${entry}'. Expected 'key=value'.`);
    }

    const key = entry.slice(0, equalsIndex).trim();
    const value = entry.slice(equalsIndex + 1).trim();

    if (key.length === 0) {
      throw new Error(
        `Invalid OTEL resource attribute '${entry}'. Resource attribute keys must not be empty.`,
      );
    }

    attributes[key] = value;
  }

  return attributes;
}
