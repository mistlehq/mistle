import { Buffer } from "node:buffer";

import type { AnyIntegrationDefinition } from "@mistle/integrations-core";

export const DesignerIntegrationCatalogSourcePath =
  "apps/control-plane-api/src/designer/runtime-references/integration-catalog.md";
export const DesignerIntegrationCatalogRuntimePath =
  "/root/.mistle/designer/references/integration-catalog.md";
export const DesignerIntegrationCatalogFileId = "designer_integration_catalog";
export const DesignerIntegrationCatalogMaxBytes = 65_536;

const GeneratedHeader = `<!-- Generated from the Mistle integration registry. Do not edit by hand. Run pnpm --filter @mistle/control-plane-api designer:integration-catalog:generate. -->`;

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

  lines.push("", "Resource kinds:", "");
  const resourceDefinitions = definition.resourceDefinitions ?? [];
  if (resourceDefinitions.length === 0) {
    lines.push("- None");
  } else {
    for (const resource of resourceDefinitions) {
      lines.push(
        `- \`${resource.kind}\`: ${resource.displayNamePlural} (${resource.selectionMode})`,
      );
    }
  }

  lines.push("", "Trigger events:", "");
  const supportedWebhookEvents = definition.supportedWebhookEvents ?? [];
  if (supportedWebhookEvents.length === 0) {
    lines.push("- None");
  } else {
    for (const event of supportedWebhookEvents) {
      lines.push(`- \`${event.eventType}\`: ${event.displayName}`);
    }
  }

  lines.push("");
  return lines;
}
