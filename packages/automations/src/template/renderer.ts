import { Liquid } from "liquidjs";

type RenderTemplateStringInput = {
  template: string;
  context: Record<string, unknown>;
};

function serializeTemplateOutput(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (value === null) {
    return "null";
  }

  if (Array.isArray(value) || (typeof value === "object" && value !== null)) {
    return JSON.stringify(value);
  }

  throw new Error(`Template value type '${typeof value}' is not supported.`);
}

const TemplateEngine = new Liquid({
  strictVariables: true,
  strictFilters: true,
  outputEscape: serializeTemplateOutput,
});

export function renderTemplateString(input: RenderTemplateStringInput): string {
  return TemplateEngine.parseAndRenderSync(input.template, input.context);
}

export type { RenderTemplateStringInput };
