import { Liquid } from "liquidjs";

type RenderTemplateStringInput = {
  template: string;
  context: Record<string, unknown>;
};

const TemplateEngine = new Liquid({
  strictVariables: true,
  strictFilters: true,
});

export function renderTemplateString(input: RenderTemplateStringInput): string {
  return TemplateEngine.parseAndRenderSync(input.template, input.context);
}

export type { RenderTemplateStringInput };
