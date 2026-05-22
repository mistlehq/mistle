import {
  IntegrationMcpTransports,
  resolveRoutePathPrefixFromBaseUrl,
  type CompileBindingResult,
  type EgressCredentialResolverRef,
  type IntegrationMcpServer,
  type ResolvedIntegrationForm,
} from "@mistle/integrations-core";
import { z } from "zod";

export type RemoteMcpServerCatalogEntry = {
  id: string;
  displayName: string;
  url: string;
  description?: string;
};

type RemoteMcpServerRouteAuthInjection =
  CompileBindingResult["egressRoutes"][number]["authInjection"];

export function createRemoteMcpServerSelectionSchema(input: {
  catalog: ReadonlyArray<RemoteMcpServerCatalogEntry>;
}) {
  const catalogById = buildRemoteMcpServerCatalogById(input.catalog);

  return z
    .array(z.string().trim().min(1))
    .default([])
    .superRefine((selectedIds, ctx) => {
      const seenIds = new Set<string>();

      for (const [index, selectedId] of selectedIds.entries()) {
        if (!catalogById.has(selectedId)) {
          ctx.addIssue({
            code: "custom",
            message: `Unsupported remote MCP server id '${selectedId}'.`,
            path: [index],
          });
          continue;
        }

        if (seenIds.has(selectedId)) {
          ctx.addIssue({
            code: "custom",
            message: `Duplicate remote MCP server id '${selectedId}'.`,
            path: [index],
          });
        }
        seenIds.add(selectedId);
      }
    });
}

export function resolveRemoteMcpServerSelectionForm(input: {
  catalog: ReadonlyArray<RemoteMcpServerCatalogEntry>;
  fieldName: string;
  title?: string;
  defaultSelectedIds?: ReadonlyArray<string>;
  emptyMessage?: string;
}): ResolvedIntegrationForm {
  validateRemoteMcpServerCatalog(input.catalog);
  const defaultSelectedIds = input.defaultSelectedIds ?? [];
  assertKnownRemoteMcpServerIds({
    catalog: input.catalog,
    selectedIds: defaultSelectedIds,
  });

  return {
    schema: {
      properties: {
        [input.fieldName]: {
          title: input.title ?? "Remote MCP servers",
          default: [...defaultSelectedIds],
          items: {
            type: "string",
            enum: input.catalog.map((entry) => entry.id),
          },
          type: "array",
          uniqueItems: true,
        },
      },
    },
    uiSchema: {
      [input.fieldName]: {
        "ui:enumNames": input.catalog.map((entry) => entry.displayName),
        "ui:widget": "checkboxes",
        "ui:options": {
          inline: false,
          emptyMessage: input.emptyMessage ?? "No matching remote MCP servers.",
        },
      },
    },
  };
}

export function resolveRemoteMcpServers(input: {
  catalog: ReadonlyArray<RemoteMcpServerCatalogEntry>;
  selectedIds: ReadonlyArray<string>;
}): ReadonlyArray<IntegrationMcpServer> {
  return resolveSelectedRemoteMcpServerEntries(input).map((entry) => ({
    serverId: entry.id,
    serverName: entry.id,
    transport: IntegrationMcpTransports.STREAMABLE_HTTP,
    url: entry.url,
    ...(entry.description === undefined ? {} : { description: entry.description }),
  }));
}

export function compileRemoteMcpServerEgressRoutes(input: {
  catalog: ReadonlyArray<RemoteMcpServerCatalogEntry>;
  selectedIds: ReadonlyArray<string>;
  authInjection: RemoteMcpServerRouteAuthInjection;
  credentialResolver: EgressCredentialResolverRef;
}): CompileBindingResult["egressRoutes"] {
  return resolveSelectedRemoteMcpServerEntries(input).map((entry) => {
    const parsedUrl = new URL(entry.url);

    return {
      match: {
        hosts: [parsedUrl.hostname],
        pathPrefixes: [resolveRoutePathPrefixFromBaseUrl(entry.url)],
      },
      upstream: {
        baseUrl: entry.url,
      },
      authInjection: input.authInjection,
      credentialResolver: input.credentialResolver,
    };
  });
}

function resolveSelectedRemoteMcpServerEntries(input: {
  catalog: ReadonlyArray<RemoteMcpServerCatalogEntry>;
  selectedIds: ReadonlyArray<string>;
}): ReadonlyArray<RemoteMcpServerCatalogEntry> {
  validateRemoteMcpServerCatalog(input.catalog);
  assertKnownRemoteMcpServerIds(input);
  const selectedIdSet = new Set(input.selectedIds);

  return input.catalog.filter((entry) => selectedIdSet.has(entry.id));
}

function buildRemoteMcpServerCatalogById(
  catalog: ReadonlyArray<RemoteMcpServerCatalogEntry>,
): ReadonlyMap<string, RemoteMcpServerCatalogEntry> {
  validateRemoteMcpServerCatalog(catalog);

  return new Map(catalog.map((entry) => [entry.id, entry]));
}

function validateRemoteMcpServerCatalog(catalog: ReadonlyArray<RemoteMcpServerCatalogEntry>): void {
  const seenIds = new Set<string>();

  for (const entry of catalog) {
    if (!isRemoteMcpServerId(entry.id)) {
      throw new Error(
        `Remote MCP server id '${entry.id}' must use lowercase letters, numbers, and underscores.`,
      );
    }

    if (entry.displayName.trim().length === 0) {
      throw new Error(`Remote MCP server '${entry.id}' is missing a display name.`);
    }

    if (seenIds.has(entry.id)) {
      throw new Error(`Duplicate remote MCP server id '${entry.id}'.`);
    }
    seenIds.add(entry.id);

    const parsedUrl = new URL(entry.url);
    if (parsedUrl.protocol !== "https:") {
      throw new Error(`Remote MCP server '${entry.id}' must use an https URL.`);
    }

    if (parsedUrl.port.length > 0) {
      throw new Error(`Remote MCP server '${entry.id}' must not include an explicit port.`);
    }
  }
}

function assertKnownRemoteMcpServerIds(input: {
  catalog: ReadonlyArray<RemoteMcpServerCatalogEntry>;
  selectedIds: ReadonlyArray<string>;
}): void {
  const catalogIds = new Set(input.catalog.map((entry) => entry.id));
  const seenSelectedIds = new Set<string>();

  for (const selectedId of input.selectedIds) {
    if (!catalogIds.has(selectedId)) {
      throw new Error(`Unsupported remote MCP server id '${selectedId}'.`);
    }

    if (seenSelectedIds.has(selectedId)) {
      throw new Error(`Duplicate remote MCP server id '${selectedId}'.`);
    }
    seenSelectedIds.add(selectedId);
  }
}

function isRemoteMcpServerId(id: string): boolean {
  return /^[a-z][a-z0-9_]*$/u.test(id);
}
