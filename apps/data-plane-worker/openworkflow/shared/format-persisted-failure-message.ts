const MaxFailureDetailLength = 800;
const MaxFailureChainDepth = 8;

function hasCause(value: unknown): value is { cause: unknown } {
  return typeof value === "object" && value !== null && "cause" in value;
}

function hasErrorMessage(value: unknown): value is { message: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "message" in value &&
    typeof value.message === "string"
  );
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

function redactSecrets(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi, "Bearer [REDACTED]")
    .replace(/\bgh[pousr]_[A-Za-z0-9]+\b/g, "[REDACTED]")
    .replace(/\bxox[baprs]-[A-Za-z0-9-]+\b/g, "[REDACTED]");
}

function extractFirstJsonObject(value: string): string | null {
  const startIndex = value.indexOf("{");
  if (startIndex < 0) {
    return null;
  }

  let depth = 0;
  let isInsideString = false;
  let isEscaped = false;

  for (let index = startIndex; index < value.length; index += 1) {
    const character = value[index];
    if (character === undefined) {
      break;
    }

    if (isInsideString) {
      if (isEscaped) {
        isEscaped = false;
        continue;
      }

      if (character === "\\") {
        isEscaped = true;
        continue;
      }

      if (character === '"') {
        isInsideString = false;
      }

      continue;
    }

    if (character === '"') {
      isInsideString = true;
      continue;
    }

    if (character === "{") {
      depth += 1;
      continue;
    }

    if (character !== "}") {
      continue;
    }

    depth -= 1;
    if (depth === 0) {
      return value.slice(startIndex, index + 1);
    }
  }

  return null;
}

function extractStructuredCommandError(message: string): string | null {
  for (const marker of ["stdout:", "stderr:"]) {
    const markerIndex = message.indexOf(marker);
    if (markerIndex < 0) {
      continue;
    }

    const jsonValue = extractFirstJsonObject(message.slice(markerIndex + marker.length));
    if (jsonValue === null) {
      continue;
    }

    try {
      const parsed: unknown = JSON.parse(jsonValue);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "error" in parsed &&
        typeof parsed.error === "string" &&
        parsed.error.trim().length > 0
      ) {
        return normalizeWhitespace(parsed.error);
      }
    } catch {
      continue;
    }
  }

  return null;
}

function isUsefulDetail(detail: string, summary: string): boolean {
  if (detail.length === 0) {
    return false;
  }

  if (detail === summary) {
    return false;
  }

  if (/^exit status \d+$/i.test(detail)) {
    return false;
  }

  return true;
}

function extractErrorMessages(error: unknown): string[] {
  const messages: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  let depth = 0;

  while (current !== undefined && current !== null && depth < MaxFailureChainDepth) {
    if (seen.has(current)) {
      break;
    }
    seen.add(current);

    if (typeof current === "string") {
      messages.push(current);
    } else if (current instanceof Error || hasErrorMessage(current)) {
      messages.push(current.message);
    }

    if (!hasCause(current)) {
      break;
    }

    current = current.cause;
    depth += 1;
  }

  return messages;
}

function extractFailureDetail(error: unknown, summary: string): string | null {
  const seenDetails = new Set<string>();

  for (const message of extractErrorMessages(error)) {
    const normalizedMessage = normalizeWhitespace(message);
    const structuredDetail = extractStructuredCommandError(normalizedMessage);
    const candidateDetails =
      structuredDetail === null ? [normalizedMessage] : [structuredDetail, normalizedMessage];

    for (const detail of candidateDetails) {
      const sanitizedDetail = redactSecrets(truncate(detail, MaxFailureDetailLength));
      if (!isUsefulDetail(sanitizedDetail, summary) || seenDetails.has(sanitizedDetail)) {
        continue;
      }

      seenDetails.add(sanitizedDetail);
      return sanitizedDetail;
    }
  }

  return null;
}

export function formatPersistedFailureMessage(input: { summary: string; error: unknown }): string {
  const detail = extractFailureDetail(input.error, input.summary);
  if (detail === null) {
    return input.summary;
  }

  return `${input.summary}\n\nCause: ${detail}`;
}
