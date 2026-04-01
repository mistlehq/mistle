export type OtlpHeaders = Record<string, string>;

export type OtlpSignalRuntimeConfig = {
  endpoint: string;
  headers?: OtlpHeaders | undefined;
};

export type OtlpHttpExporterConfig =
  | {
      url: string;
    }
  | {
      url: string;
      headers: OtlpHeaders;
    };

export function buildOtlpHttpExporterConfig(
  input: OtlpSignalRuntimeConfig,
): OtlpHttpExporterConfig {
  if (input.headers === undefined) {
    return {
      url: input.endpoint,
    };
  }

  return {
    url: input.endpoint,
    headers: input.headers,
  };
}

export function parseOtlpHeadersJson(input: { envName: string; rawValue: string }): OtlpHeaders {
  let parsedValue: unknown;

  try {
    parsedValue = JSON.parse(input.rawValue);
  } catch (error) {
    throw new Error(
      `Invalid ${input.envName}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (typeof parsedValue !== "object" || parsedValue === null || Array.isArray(parsedValue)) {
    throw new Error(`Invalid ${input.envName}: expected a JSON object.`);
  }

  const headers: OtlpHeaders = {};

  for (const [headerName, headerValue] of Object.entries(parsedValue)) {
    if (typeof headerValue !== "string") {
      throw new Error(`Invalid ${input.envName}: header '${headerName}' must be a string.`);
    }

    headers[headerName] = headerValue;
  }

  return headers;
}

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
