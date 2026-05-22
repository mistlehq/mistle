import {
  resolveIntegrationForm,
  type EgressCredentialResolverRef,
} from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  compileRemoteMcpServerEgressRoutes,
  createRemoteMcpServerSelectionSchema,
  resolveRemoteMcpServerSelectionForm,
  resolveRemoteMcpServers,
  type RemoteMcpServerCatalogEntry,
} from "./index.js";

const TestCatalog = [
  {
    id: "provider_primary",
    displayName: "Provider Primary",
    url: "https://mcp.example.com/mcp/primary",
    description: "Primary remote MCP server.",
  },
  {
    id: "provider_insights",
    displayName: "Provider Insights",
    url: "https://mcp.example.com/mcp/insights",
  },
] satisfies ReadonlyArray<RemoteMcpServerCatalogEntry>;

const CredentialResolver = {
  kind: "integration_connection",
  connectionId: "icn_123",
  secretType: "oauth2_access_token",
  slotKey: "provider.oauth.access-token",
} satisfies EgressCredentialResolverRef;

describe("remote MCP server catalog", () => {
  it("validates selected remote MCP server ids", () => {
    const schema = z
      .object({
        remoteMcpServers: createRemoteMcpServerSelectionSchema({
          catalog: TestCatalog,
        }),
      })
      .strict();

    expect(
      schema.parse({
        remoteMcpServers: ["provider_primary", "provider_insights"],
      }),
    ).toEqual({
      remoteMcpServers: ["provider_primary", "provider_insights"],
    });
    expect(schema.parse({})).toEqual({
      remoteMcpServers: [],
    });
    expect(() =>
      schema.parse({
        remoteMcpServers: ["provider_primary", "unknown_server"],
      }),
    ).toThrow("Unsupported remote MCP server id 'unknown_server'.");
    expect(() =>
      schema.parse({
        remoteMcpServers: ["provider_primary", "provider_primary"],
      }),
    ).toThrow("Duplicate remote MCP server id 'provider_primary'.");
  });

  it("renders a binding form from catalog entries", () => {
    const schema = z
      .object({
        remoteMcpServers: createRemoteMcpServerSelectionSchema({
          catalog: TestCatalog,
        }),
      })
      .strict();
    const resolvedForm = resolveIntegrationForm({
      schema,
      form: () =>
        resolveRemoteMcpServerSelectionForm({
          catalog: TestCatalog,
          fieldName: "remoteMcpServers",
          title: "Remote MCP servers",
          defaultSelectedIds: ["provider_primary"],
        }),
      context: {
        familyId: "provider",
        variantId: "provider-mcp",
        kind: "connector",
      },
    });

    expect(resolvedForm.schema).toMatchObject({
      properties: {
        remoteMcpServers: {
          title: "Remote MCP servers",
          default: ["provider_primary"],
          items: {
            type: "string",
            enum: ["provider_primary", "provider_insights"],
          },
          type: "array",
          uniqueItems: true,
        },
      },
    });
    expect(resolvedForm.uiSchema).toEqual({
      remoteMcpServers: {
        "ui:enumNames": ["Provider Primary", "Provider Insights"],
        "ui:widget": "checkboxes",
        "ui:options": {
          inline: false,
          emptyMessage: "No matching remote MCP servers.",
        },
      },
    });
  });

  it("resolves selected catalog entries to streamable HTTP MCP servers", () => {
    expect(
      resolveRemoteMcpServers({
        catalog: TestCatalog,
        selectedIds: ["provider_insights", "provider_primary"],
      }),
    ).toEqual([
      {
        serverId: "provider_primary",
        serverName: "provider_primary",
        transport: "streamable-http",
        url: "https://mcp.example.com/mcp/primary",
        description: "Primary remote MCP server.",
      },
      {
        serverId: "provider_insights",
        serverName: "provider_insights",
        transport: "streamable-http",
        url: "https://mcp.example.com/mcp/insights",
      },
    ]);
  });

  it("compiles selected catalog entries to bearer-authenticated egress routes", () => {
    expect(
      compileRemoteMcpServerEgressRoutes({
        catalog: TestCatalog,
        selectedIds: ["provider_insights", "provider_primary"],
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: CredentialResolver,
      }),
    ).toEqual([
      {
        match: {
          hosts: ["mcp.example.com"],
          pathPrefixes: ["/mcp/primary"],
        },
        upstream: {
          baseUrl: "https://mcp.example.com/mcp/primary",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: CredentialResolver,
      },
      {
        match: {
          hosts: ["mcp.example.com"],
          pathPrefixes: ["/mcp/insights"],
        },
        upstream: {
          baseUrl: "https://mcp.example.com/mcp/insights",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: CredentialResolver,
      },
    ]);
  });

  it("rejects catalog definitions that cannot produce safe MCP server names", () => {
    expect(() =>
      resolveRemoteMcpServers({
        catalog: [
          {
            id: "Provider Primary",
            displayName: "Provider Primary",
            url: "https://mcp.example.com/mcp/primary",
          },
        ],
        selectedIds: ["Provider Primary"],
      }),
    ).toThrow(
      "Remote MCP server id 'Provider Primary' must use lowercase letters, numbers, and underscores.",
    );
  });

  it("requires remote MCP server URLs to use https", () => {
    expect(() =>
      compileRemoteMcpServerEgressRoutes({
        catalog: [
          {
            id: "provider_primary",
            displayName: "Provider Primary",
            url: "http://mcp.example.com/mcp/primary",
          },
        ],
        selectedIds: ["provider_primary"],
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: CredentialResolver,
      }),
    ).toThrow("Remote MCP server 'provider_primary' must use an https URL.");
  });

  it("rejects remote MCP server URLs with explicit ports", () => {
    expect(() =>
      compileRemoteMcpServerEgressRoutes({
        catalog: [
          {
            id: "provider_primary",
            displayName: "Provider Primary",
            url: "https://mcp.example.com:8443/mcp/primary",
          },
        ],
        selectedIds: ["provider_primary"],
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: CredentialResolver,
      }),
    ).toThrow("Remote MCP server 'provider_primary' must not include an explicit port.");
  });

  it("normalizes trailing slash path prefixes for egress route matching", () => {
    expect(
      compileRemoteMcpServerEgressRoutes({
        catalog: [
          {
            id: "provider_primary",
            displayName: "Provider Primary",
            url: "https://mcp.example.com/mcp/primary/",
          },
        ],
        selectedIds: ["provider_primary"],
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: CredentialResolver,
      }),
    ).toEqual([
      {
        match: {
          hosts: ["mcp.example.com"],
          pathPrefixes: ["/mcp/primary"],
        },
        upstream: {
          baseUrl: "https://mcp.example.com/mcp/primary/",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: CredentialResolver,
      },
    ]);
  });

  it("rejects duplicate selected ids when resolving routes", () => {
    expect(() =>
      compileRemoteMcpServerEgressRoutes({
        catalog: TestCatalog,
        selectedIds: ["provider_primary", "provider_primary"],
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: CredentialResolver,
      }),
    ).toThrow("Duplicate remote MCP server id 'provider_primary'.");
  });
});
