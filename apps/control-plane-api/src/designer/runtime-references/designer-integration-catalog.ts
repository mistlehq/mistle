import { Buffer } from "node:buffer";

import {
  resolveIntegrationForm,
  type AnyIntegrationDefinition,
  type IntegrationFormContext,
  type IntegrationWebhookEventDefinition,
  type IntegrationWebhookPayloadReference,
} from "@mistle/integrations-core";

export const DesignerIntegrationCatalogSourcePath =
  "apps/control-plane-api/src/designer/runtime-references/integrations/index.md";
export const DesignerIntegrationCatalogSourceDirectoryPath =
  "apps/control-plane-api/src/designer/runtime-references/integrations";
export const DesignerIntegrationCatalogRuntimePath =
  "/root/.mistle/designer/references/integrations/index.md";
export const DesignerIntegrationCatalogRuntimeDirectoryPath =
  "/root/.mistle/designer/references/integrations";
export const DesignerIntegrationCatalogFileId = "designer_integration_catalog_index";
export const DesignerIntegrationCatalogIndexMaxBytes = 16_384;
export const DesignerIntegrationCatalogDetailMaxBytes = 16_384;

const GeneratedHeader = `<!-- Generated from the Mistle integration registry. Do not edit by hand. Run pnpm --filter @mistle/control-plane-api designer:integration-catalog:generate. -->`;

type BindingToolReference = {
  id: string;
  label?: string | undefined;
  selectedByDefault: boolean;
};

export type DesignerIntegrationCatalogFile = {
  fileName: string;
  sourcePath: string;
  runtimePath: string;
  fileId: string;
  markdown: string;
};

export function renderDesignerIntegrationCatalogFiles(
  definitions: ReadonlyArray<AnyIntegrationDefinition>,
): readonly DesignerIntegrationCatalogFile[] {
  const sortedDefinitions = definitions
    .filter((definition) => definition.connectionMethods.length > 0)
    .sort(compareDefinitions);
  const files: DesignerIntegrationCatalogFile[] = [
    {
      fileName: "index.md",
      sourcePath: DesignerIntegrationCatalogSourcePath,
      runtimePath: DesignerIntegrationCatalogRuntimePath,
      fileId: DesignerIntegrationCatalogFileId,
      markdown: renderDesignerIntegrationCatalogIndexMarkdown(sortedDefinitions),
    },
  ];

  for (const definition of sortedDefinitions) {
    const fileName = createDefinitionFileName(definition);
    files.push({
      fileName,
      sourcePath: `${DesignerIntegrationCatalogSourceDirectoryPath}/${fileName}`,
      runtimePath: `${DesignerIntegrationCatalogRuntimeDirectoryPath}/${fileName}`,
      fileId: `designer_integration_catalog_${definition.variantId.replaceAll("-", "_")}`,
      markdown: renderDesignerIntegrationDetailMarkdown(definition),
    });
  }

  return files;
}

export function renderDesignerIntegrationCatalogIndexMarkdown(
  definitions: ReadonlyArray<AnyIntegrationDefinition>,
): string {
  const lines = [
    GeneratedHeader,
    "",
    "# Designer Integration Reference Index",
    "",
    "Search this directory with `rg` to resolve user-facing provider names, provider family ids, integration target keys, setup method ids, binding kinds, supported resource kinds, trigger events, and binding tool ids. Read only the matching detail file before configuring that integration.",
    "",
    "Reference directory: `.mistle/designer/references/integrations/`",
    "",
    "Integration files:",
    "",
  ];

  for (const definition of definitions) {
    lines.push(...renderIndexDefinitionEntry(definition));
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderDesignerIntegrationDetailMarkdown(
  definition: AnyIntegrationDefinition,
): string {
  return `${[GeneratedHeader, "", ...renderDefinitionSection({ definition, headingLevel: 1 })]
    .join("\n")
    .trimEnd()}\n`;
}

export function assertDesignerIntegrationCatalogFilesWithinBudget(
  files: readonly DesignerIntegrationCatalogFile[],
): void {
  for (const file of files) {
    const sizeBytes = Buffer.byteLength(file.markdown, "utf8");
    const maxBytes =
      file.fileName === "index.md"
        ? DesignerIntegrationCatalogIndexMaxBytes
        : DesignerIntegrationCatalogDetailMaxBytes;
    if (sizeBytes > maxBytes) {
      throw new Error(
        `Designer integration catalog file '${file.fileName}' is ${String(
          sizeBytes,
        )} bytes, exceeding the ${String(maxBytes)} byte budget.`,
      );
    }
  }
}

export function assertDesignerIntegrationCatalogWithinBudget(markdown: string): void {
  const sizeBytes = Buffer.byteLength(markdown, "utf8");
  if (sizeBytes > DesignerIntegrationCatalogIndexMaxBytes) {
    throw new Error(
      `Designer integration catalog is ${String(sizeBytes)} bytes, exceeding the ${String(
        DesignerIntegrationCatalogIndexMaxBytes,
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

function renderIndexDefinitionEntry(definition: AnyIntegrationDefinition): string[] {
  const fileName = createDefinitionFileName(definition);
  const lines = [
    `- ${definition.displayName}`,
    `  - Provider family ID: \`${definition.familyId}\``,
    `  - Integration target key: \`${definition.variantId}\``,
    `  - Binding kind: \`${definition.kind}\``,
    `  - Detail file: \`${fileName}\``,
  ];

  return lines;
}

function renderDefinitionSection(input: {
  definition: AnyIntegrationDefinition;
  headingLevel: 1 | 2;
}): string[] {
  const { definition } = input;
  const headingMarker = "#".repeat(input.headingLevel);
  const lines = [
    `${headingMarker} ${definition.displayName}`,
    "",
    `Provider family ID: \`${definition.familyId}\``,
    `Integration target key: \`${definition.variantId}\``,
    `Variant ID: \`${definition.variantId}\``,
    `Binding kind: \`${definition.kind}\``,
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
      lines.push(...renderWebhookEventTemplateReferenceLines(event));
    }
  }

  lines.push("");
  return lines;
}

function createDefinitionFileName(definition: AnyIntegrationDefinition): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(definition.variantId)) {
    throw new Error(
      `Integration target key '${definition.variantId}' cannot be used as a Designer reference file name.`,
    );
  }

  return `${definition.variantId}.md`;
}

function renderWebhookEventTemplateReferenceLines(
  event: IntegrationWebhookEventDefinition,
): string[] {
  const lines: string[] = [];
  const payloadReferences = event.payloadReferences ?? [];
  if (payloadReferences.length > 0) {
    lines.push(`  - Template fields: ${renderWebhookTemplateFields(payloadReferences)}`);
  }

  return lines;
}

function renderWebhookTemplateFields(
  payloadReferences: readonly IntegrationWebhookPayloadReference[],
): string {
  const fields = new Set([
    "{{webhookEvent.eventType}}",
    ...payloadReferences.map(renderPayloadTemplateField),
  ]);

  return [...fields].map((field) => `\`${field}\``).join(", ");
}

function renderPayloadTemplateField(reference: IntegrationWebhookPayloadReference): string {
  return `{{payload${reference.path.map(renderPayloadTemplatePathSegment).join("")}}}`;
}

function renderPayloadTemplatePathSegment(segment: string): string {
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment)) {
    return `.${segment}`;
  }

  return `[${JSON.stringify(segment)}]`;
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
  return [
    ...readBindingToolReferencesForProperty({
      ...input,
      propertyName: "tools",
    }),
    ...readBindingToolReferencesForProperty({
      ...input,
      propertyName: "mcpServers",
    }),
  ];
}

function readBindingToolReferencesForProperty(input: {
  propertyName: string;
  schema?: Record<string, unknown> | undefined;
  uiSchema?: Record<string, unknown> | undefined;
}): readonly BindingToolReference[] {
  const properties = readJsonObject(input.schema?.properties);
  const toolsSchema = readJsonObject(properties?.[input.propertyName]);
  const itemsSchema = readJsonObject(toolsSchema?.items);
  const toolIds = readStringArray(itemsSchema?.enum);
  const defaultToolIds = new Set(readStringArray(toolsSchema?.default));
  const toolsUiSchema = readJsonObject(input.uiSchema?.[input.propertyName]);
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
