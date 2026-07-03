import { createIntegrationRegistry } from "@mistle/integrations-definitions/server";
import { describe, expect, it } from "vitest";

import {
  assertDesignerIntegrationCatalogFilesWithinBudget,
  renderDesignerIntegrationCatalogFiles,
} from "./designer-integration-catalog.js";

describe("Designer integration catalog", () => {
  it("renders compact static metadata for Linear lookup in the index", () => {
    const files = renderDesignerIntegrationCatalogFiles(
      createIntegrationRegistry().listDefinitions(),
    );
    const indexMarkdown = readCatalogFile(files, "index.md").markdown;

    assertDesignerIntegrationCatalogFilesWithinBudget(files);
    expect(indexMarkdown).toContain("<!-- Generated from the Mistle integration registry.");
    expect(indexMarkdown).toContain("- Linear");
    expect(indexMarkdown).toContain("Provider family ID: `linear`");
    expect(indexMarkdown).toContain("Integration target key: `linear-default`");
    expect(indexMarkdown).toContain("Binding kind: `connector`");
    expect(indexMarkdown).toContain("Detail file: `linear-default.md`");
    expect(indexMarkdown).not.toContain("Binding tool ids:");
  });

  it("renders binding tool defaults in GitHub detail reference", () => {
    const files = renderDesignerIntegrationCatalogFiles(
      createIntegrationRegistry().listDefinitions(),
    );

    const githubMarkdown = readCatalogFile(files, "github-cloud.md").markdown;

    assertDesignerIntegrationCatalogFilesWithinBudget(files);
    expect(githubMarkdown).toContain("# GitHub");
    expect(githubMarkdown).toContain("Integration target key: `github-cloud`");
    expect(githubMarkdown).toContain("Binding kind: `git`");
    expect(githubMarkdown).toContain("- `github-cli`: GitHub CLI (default)");
  });

  it("renders webhook template fields from trigger payload references", () => {
    const files = renderDesignerIntegrationCatalogFiles(
      createIntegrationRegistry().listDefinitions(),
    );

    const pullRequestOpenedEvent = readCatalogListItem(
      readCatalogFile(files, "github-cloud.md").markdown,
      "`github.pull_request.opened`",
    );

    assertDesignerIntegrationCatalogFilesWithinBudget(files);
    expect(pullRequestOpenedEvent).toContain("Template fields:");
    expect(pullRequestOpenedEvent).toContain("`{{webhookEvent.eventType}}`");
    expect(pullRequestOpenedEvent).toContain("`{{payload.repository.full_name}}`");
    expect(pullRequestOpenedEvent).toContain("`{{payload.pull_request.number}}`");
    expect(pullRequestOpenedEvent).toContain("`{{payload.pull_request.base.ref}}`");
    expect(pullRequestOpenedEvent).not.toContain("{{event.");
  });

  it("renders OpenAI as an agent model-provider binding", () => {
    const files = renderDesignerIntegrationCatalogFiles(
      createIntegrationRegistry().listDefinitions(),
    );

    const openAiMarkdown = readCatalogFile(files, "openai-default.md").markdown;

    expect(openAiMarkdown).toContain("Binding kind: `agent`");
    expect(openAiMarkdown).toContain("- `api-key` (form): API key");
    expect(openAiMarkdown).toContain(
      "- `chatgpt-device-code` (device-authorization): ChatGPT subscription",
    );
    expect(openAiMarkdown).not.toContain("Binding tools:");
  });

  it("renders Google Workspace MCP server choices as binding tools", () => {
    const files = renderDesignerIntegrationCatalogFiles(
      createIntegrationRegistry().listDefinitions(),
    );

    const googleWorkspaceMarkdown = readCatalogFile(files, "google-workspace-mcp.md").markdown;

    expect(googleWorkspaceMarkdown).toContain("Binding tools:");
    expect(googleWorkspaceMarkdown).toContain("- `gmail`: Gmail (default)");
    expect(googleWorkspaceMarkdown).toContain("- `drive`: Google Drive (default)");
    expect(googleWorkspaceMarkdown).toContain("- `sheets`: Google Sheets (default)");
  });

  it("omits optional catalog sections when the integration has no values", () => {
    const files = renderDesignerIntegrationCatalogFiles(
      createIntegrationRegistry().listDefinitions(),
    );

    const anthropicMarkdown = readCatalogFile(files, "anthropic-default.md").markdown;

    expect(anthropicMarkdown).toContain("Setup methods:");
    expect(anthropicMarkdown).not.toContain("Resource kinds:");
    expect(anthropicMarkdown).not.toContain("Binding tools:");
    expect(anthropicMarkdown).not.toContain("Trigger events:");
    expect(anthropicMarkdown).not.toContain("- None");
  });
});

function readCatalogFile(
  files: ReturnType<typeof renderDesignerIntegrationCatalogFiles>,
  fileName: string,
): { markdown: string } {
  const file = files.find((entry) => entry.fileName === fileName);
  if (file === undefined) {
    throw new Error(`Catalog file '${fileName}' was not rendered.`);
  }

  return file;
}

function readCatalogListItem(section: string, listItemMarker: string): string {
  const listItemStart = section.indexOf(`- ${listItemMarker}`);
  if (listItemStart === -1) {
    throw new Error(`Catalog list item '${listItemMarker}' was not rendered.`);
  }

  const nextListItemStart = section.indexOf("\n- ", listItemStart + listItemMarker.length);
  if (nextListItemStart === -1) {
    return section.slice(listItemStart);
  }

  return section.slice(listItemStart, nextListItemStart);
}
