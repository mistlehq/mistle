type RenderTemplateStringInput = {
  template: string;
  context: Record<string, unknown>;
};

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function isArrayIndexSegment(input: string): boolean {
  return /^[0-9]+$/.test(input);
}

function parsePathExpression(pathExpression: string): string[] {
  const trimmed = pathExpression.trim();
  if (trimmed.length === 0) {
    throw new Error("Template path expression must not be empty.");
  }

  const segments = trimmed.split(".");
  for (const segment of segments) {
    if (segment.length === 0) {
      throw new Error(`Template path expression '${pathExpression}' is invalid.`);
    }
  }

  return segments;
}

function resolvePathValue(input: {
  context: Record<string, unknown>;
  pathSegments: ReadonlyArray<string>;
}): unknown {
  let current: unknown = input.context;

  for (const segment of input.pathSegments) {
    if (Array.isArray(current)) {
      if (!isArrayIndexSegment(segment)) {
        return undefined;
      }
      const index = Number(segment);
      current = current[index];
      continue;
    }

    if (!isRecord(current)) {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

function stringifyTemplateValue(input: unknown): string {
  if (typeof input === "string") {
    return input;
  }

  if (typeof input === "number" || typeof input === "boolean" || input === null) {
    return String(input);
  }

  if (Array.isArray(input) || isRecord(input)) {
    return JSON.stringify(input);
  }

  throw new Error(`Template value type '${typeof input}' is not supported.`);
}

const TemplateTokenPattern = /{{\s*([^{}]+?)\s*}}/g;

export function renderTemplateString(input: RenderTemplateStringInput): string {
  return input.template.replace(TemplateTokenPattern, (_, pathExpression: string) => {
    const pathSegments = parsePathExpression(pathExpression);
    const resolvedValue = resolvePathValue({
      context: input.context,
      pathSegments,
    });

    if (resolvedValue === undefined) {
      throw new Error(`Template path '${pathExpression}' could not be resolved.`);
    }

    return stringifyTemplateValue(resolvedValue);
  });
}

export type { RenderTemplateStringInput };
