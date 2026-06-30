import { Buffer } from "node:buffer";

import {
  resolveIntegrationForm,
  type AnyIntegrationDefinition,
  type IntegrationFormContext,
} from "@mistle/integrations-core";

export const DesignerIntegrationCatalogSourcePath =
  "apps/control-plane-api/src/designer/runtime-references/integration-catalog.md";
export const DesignerIntegrationCatalogRuntimePath =
  "/root/.mistle/designer/references/integration-catalog.md";
export const DesignerIntegrationCatalogFileId = "designer_integration_catalog";
export const DesignerIntegrationCatalogMaxBytes = 65_536;

const GeneratedHeader = `<!-- Generated from the Mistle integration registry. Do not edit by hand. Run pnpm --filter @mistle/control-plane-api designer:integration-catalog:generate. -->`;

type BindingToolReference = {
  id: string;
  label?: string | undefined;
  selectedByDefault: boolean;
};

export function renderDesignerIntegrationCatalogMarkdown(
  definitions: ReadonlyArray<AnyIntegrationDefinition>,
): string {
  const sortedDefinitions = definitions
    .filter((definition) => definition.connectionMethods.length > 0)
    .sort(compareDefinitions);
  const lines = [
    GeneratedHeader,
    "",
    "# Designer Integration Catalog",
    "",
    "Static integration metadata for Mistle Designer runtime lookup. Use this file to resolve user-facing provider names to provider family ids, integration target keys, setup method ids, and supported resource kinds before broad integration MCP discovery.",
    "",
  ];

  for (const definition of sortedDefinitions) {
    lines.push(...renderDefinitionSection(definition));
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function assertDesignerIntegrationCatalogWithinBudget(markdown: string): void {
  const sizeBytes = Buffer.byteLength(markdown, "utf8");
  if (sizeBytes > DesignerIntegrationCatalogMaxBytes) {
    throw new Error(
      `Designer integration catalog is ${String(sizeBytes)} bytes, exceeding the ${String(
        DesignerIntegrationCatalogMaxBytes,
      )} byte budget.`,
    );
  }
}

function compareDefinitions(
  left: AnyIntegrationDefinition,
  right: AnyIntegrationDefinition,
): number {
  const displayNameComparison = left.displayName.localeCompare(right.displayName);
  if (displayNameComparison !== 0) {
    return displayNameComparison;
  }

  const familyComparison = left.familyId.localeCompare(right.familyId);
  if (familyComparison !== 0) {
    return familyComparison;
  }

  return left.variantId.localeCompare(right.variantId);
}

function renderDefinitionSection(definition: AnyIntegrationDefinition): string[] {
  const lines = [
    `## ${definition.displayName}`,
    "",
    `Provider family ID: \`${definition.familyId}\``,
    `Integration target key: \`${definition.variantId}\``,
    `Variant ID: \`${definition.variantId}\``,
  ];

  if (definition.description !== undefined) {
    lines.push(`Description: ${definition.description}`);
  }

  lines.push("", "Setup methods:", "");
  if (definition.connectionMethods.length === 0) {
    lines.push("- None");
  } else {
    for (const method of definition.connectionMethods) {
      lines.push(`- \`${method.id}\` (${method.kind}): ${method.label}`);
    }
  }

  const resourceDefinitions = definition.resourceDefinitions ?? [];
  if (resourceDefinitions.length > 0) {
    lines.push("", "Resource kinds:", "");
    for (const resource of resourceDefinitions) {
      lines.push(
        `- \`${resource.kind}\`: ${resource.displayNamePlural} (${resource.selectionMode})`,
      );
    }
  }

  const bindingTools = resolveBindingToolReferences(definition);
  if (bindingTools.length > 0) {
    lines.push("", "Binding tools:", "");
    for (const tool of bindingTools) {
      const labelSuffix = tool.label === undefined ? "" : `: ${tool.label}`;
      const defaultSuffix = tool.selectedByDefault ? " (default)" : "";
      lines.push(`- \`${tool.id}\`${labelSuffix}${defaultSuffix}`);
    }
  }

  const supportedWebhookEvents = definition.supportedWebhookEvents ?? [];
  if (supportedWebhookEvents.length > 0) {
    lines.push("", "Trigger events:", "");
    for (const event of supportedWebhookEvents) {
      lines.push(`- \`${event.eventType}\`: ${event.displayName}`);
    }
  }

  lines.push("");
  return lines;
}

function resolveBindingToolReferences(
  definition: AnyIntegrationDefinition,
): readonly BindingToolReference[] {
  const form = resolveIntegrationForm({
    schema: definition.bindingConfigSchema,
    form: definition.bindingConfigForm,
    context: createCatalogFormContext(definition),
  });

  return readBindingToolReferences({
    schema: form.schema,
    uiSchema: form.uiSchema,
  });
}

function createCatalogFormContext(definition: AnyIntegrationDefinition): IntegrationFormContext {
  return {
    familyId: definition.familyId,
    variantId: definition.variantId,
    kind: definition.kind,
    target: {
      rawConfig: {},
      config: {},
    },
    connection: {
      id: "designer-catalog-connection",
      rawConfig: {},
      config: {},
      resources: [],
    },
    currentValue: {},
  };
}

function readBindingToolReferences(input: {
  schema?: Record<string, unknown> | undefined;
  uiSchema?: Record<string, unknown> | undefined;
}): readonly BindingToolReference[] {
  const properties = readJsonObject(input.schema?.properties);
  const toolsSchema = readJsonObject(properties?.tools);
  const itemsSchema = readJsonObject(toolsSchema?.items);
  const toolIds = readStringArray(itemsSchema?.enum);
  const defaultToolIds = new Set(readStringArray(toolsSchema?.default));
  const toolsUiSchema = readJsonObject(input.uiSchema?.tools);
  const toolLabels = readStringArray(toolsUiSchema?.["ui:enumNames"]);

  return toolIds.map((toolId, index) => ({
    id: toolId,
    ...(toolLabels[index] === undefined ? {} : { label: toolLabels[index] }),
    selectedByDefault: defaultToolIds.has(toolId),
  }));
}

function readJsonObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const record: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    record[key] = entry;
  }

  return record;
}

function readStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry) => typeof entry === "string");
}
