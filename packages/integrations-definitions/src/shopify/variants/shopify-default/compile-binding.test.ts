import type {
  RuntimeArtifactGitHubReleaseInstallHelperInput,
  RuntimeArtifactInstallStep,
  RuntimeArtifactSpec,
  RuntimeExecCommand,
  SandboxPathRefs,
} from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { ShopifyConnectionMethodIds, ShopifyCredentialSlotKeys } from "./auth.js";
import { compileShopifyBinding } from "./compile-binding.js";
import { ShopifyToolIds } from "./tool-ids.js";

function artifactBinPath(name: string): string {
  return `/usr/local/bin/${name}`;
}

const SandboxPaths: SandboxPathRefs = {
  userHomeDir: "/root",
  workspaceDir: "/root",
  runtimeDataDir: "/var/lib/mistle",
  runtimeArtifactDir: "/var/lib/mistle/artifacts",
  runtimeArtifactBinDir: "/usr/local/bin",
};

function resolveArtifactLifecycleCommands(artifact: RuntimeArtifactSpec): {
  install: ReadonlyArray<RuntimeArtifactInstallStep>;
} {
  const refs = {
    command: {
      exec(input: RuntimeExecCommand): RuntimeArtifactInstallStep {
        return {
          op: "exec",
          command: input,
        };
      },
    },
    sandboxPaths: SandboxPaths,
    artifactBinPath,
    mise: {
      install(input: {
        tools: ReadonlyArray<string>;
        force?: boolean;
        timeoutMs?: number;
      }): RuntimeArtifactInstallStep {
        return {
          op: "mise_install",
          tools: input.tools,
          ...(input.force === undefined ? {} : { force: input.force }),
          ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
        };
      },
    },
    githubReleases: {
      install(input: RuntimeArtifactGitHubReleaseInstallHelperInput): RuntimeArtifactInstallStep {
        return {
          op: "github_release_install",
          ...input,
        };
      },
    },
    compileContext: {
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "shopify-default",
      bindingId: "ibd_123",
    },
  };

  const install =
    typeof artifact.lifecycle.install === "function"
      ? artifact.lifecycle.install({ refs })
      : artifact.lifecycle.install;

  return {
    install,
  };
}

function compileWithTools(input: {
  tools: Array<(typeof ShopifyToolIds)[keyof typeof ShopifyToolIds]>;
  shopDomain?: string;
  connectionMethod?: (typeof ShopifyConnectionMethodIds)[keyof typeof ShopifyConnectionMethodIds];
}) {
  return compileShopifyBinding({
    organizationId: "org_123",
    sandboxProfileId: "sbp_123",
    version: 1,
    targetKey: "shopify-default",
    target: {
      familyId: "shopify",
      variantId: "shopify-default",
      enabled: true,
      config: {},
      secrets: {},
    },
    connection: {
      id: "icn_shopify",
      status: "active",
      config: {
        connection_method:
          input.connectionMethod ?? ShopifyConnectionMethodIds.CUSTOM_APP_CLIENT_CREDENTIALS,
        shop_domain: input.shopDomain ?? "example.myshopify.com",
        admin_api_version: "2026-04",
        client_id: "shopify-client-id",
      },
    },
    binding: {
      id: "ibd_123",
      kind: "connector",
      config: {
        tools: input.tools,
      },
    },
    refs: {
      sandboxPaths: SandboxPaths,
      artifactBinPath,
    },
  });
}

describe("compileShopifyBinding", () => {
  it("builds the expected Shopify Admin API egress route and pinned Shopify CLI artifact", () => {
    const compiled = compileWithTools({
      tools: [ShopifyToolIds.SHOPIFY_CLI],
      shopDomain: "Example.myshopify.com",
    });

    expect(compiled.egressRoutes).toEqual([
      {
        match: {
          hosts: ["example.myshopify.com"],
          pathPrefixes: ["/admin/api/2026-04"],
        },
        upstream: {
          baseUrl: "https://example.myshopify.com/admin/api/2026-04",
        },
        authInjection: {
          type: "header",
          target: "x-shopify-access-token",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_shopify",
          secretType: "oauth2_access_token",
          slotKey: ShopifyCredentialSlotKeys.CUSTOM_APP_CLIENT_CREDENTIALS_ACCESS_TOKEN,
        },
      },
    ]);

    expect(compiled.artifacts).toHaveLength(1);
    const artifact = compiled.artifacts[0];
    expect(artifact?.artifactKey).toBe("shopify-cli");
    expect(artifact?.name).toBe("Shopify CLI");
    expect(artifact?.env).toEqual({
      SHOPIFY_ADMIN_BASE_URL: "https://example.myshopify.com/admin/api/2026-04",
    });
    if (artifact === undefined) {
      throw new Error("Expected compiled Shopify CLI artifact.");
    }
    expect(resolveArtifactLifecycleCommands(artifact)).toEqual({
      install: [
        {
          op: "github_release_install",
          repository: "mistlehq/tools",
          release: {
            kind: "tag",
            match: "exact",
            tag: "shopify/v0.1.0",
          },
          asset: {
            kind: "exact",
            fileName: "shopify-linux-amd64",
            format: "binary",
            sha256: "f7d4c2768b0fc2ddfe3e99b49fb0cccecae9bb438541c1d4f98048bc2b36f966",
          },
          installPath: "/usr/local/bin/shopify",
          timeoutMs: 120_000,
        },
      ],
    });
    expect(compiled.runtimeClients).toEqual([]);
  });

  it("installs the Shopify binary and starts a local MCP server when Shopify MCP is selected", () => {
    const compiled = compileWithTools({ tools: [ShopifyToolIds.SHOPIFY_MCP] });

    expect(compiled.artifacts).toHaveLength(1);
    expect(compiled.artifacts[0]?.artifactKey).toBe("shopify-cli");
    expect(compiled.runtimeClients).toEqual([
      {
        clientId: "shopify-mcp",
        setup: {
          env: {},
          files: [],
        },
        processes: [
          {
            processKey: "shopify-mcp-server",
            command: {
              args: [
                "/usr/local/bin/shopify",
                "mcp",
                "serve",
                "--addr",
                "127.0.0.1:7348",
                "--endpoint",
                "/mcp",
              ],
            },
            readiness: {
              type: "tcp",
              host: "127.0.0.1",
              port: 7348,
              timeoutMs: 60_000,
            },
            stop: {
              signal: "sigterm",
              timeoutMs: 10_000,
              gracePeriodMs: 2_000,
            },
          },
        ],
        endpoints: [],
      },
    ]);
  });

  it("omits the Shopify artifact and runtime client when no tools are selected", () => {
    const compiled = compileWithTools({ tools: [] });

    expect(compiled.egressRoutes).toHaveLength(1);
    expect(compiled.artifacts).toEqual([]);
    expect(compiled.runtimeClients).toEqual([]);
  });

  it("uses the OAuth authorization-code access token slot for Shopify OAuth connections", () => {
    const compiled = compileWithTools({
      tools: [],
      connectionMethod: ShopifyConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
    });

    expect(compiled.egressRoutes[0]?.credentialResolver).toEqual({
      kind: "integration_connection",
      connectionId: "icn_shopify",
      secretType: "oauth2_access_token",
      slotKey: ShopifyCredentialSlotKeys.OAUTH2_AUTHORIZATION_CODE_ACCESS_TOKEN,
    });
  });
});
