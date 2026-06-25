import type {
  CompileBindingInput,
  CompileBindingResult,
  RuntimeClient,
} from "@mistle/integrations-core";

import {
  ShopifyConnectionConfigSchema,
  ShopifyConnectionMethodIds,
  ShopifyCredentialSecretTypes,
  ShopifyCredentialSlotKeys,
  normalizeShopifyShopDomain,
  resolveShopifyAdminBaseUrl,
} from "./auth.js";
import type { ShopifyBindingConfig } from "./binding-config-schema.js";
import type { ShopifyTargetConfig } from "./target-config-schema.js";
import { ShopifyToolIds } from "./tool-ids.js";

export type ShopifyCompileBindingInput = CompileBindingInput<
  ShopifyTargetConfig,
  ShopifyBindingConfig
>;

const ShopifyCliArtifactKey = "shopify-cli";
const ShopifyCliArtifactName = "Shopify CLI";
const ArtifactCommandTimeoutMs = 120_000;
export const ShopifyMcpHost = "127.0.0.1";
export const ShopifyMcpPort = 7348;
export const ShopifyMcpEndpoint = "/mcp";
export const ShopifyMcpUrl = `http://${ShopifyMcpHost}:${String(ShopifyMcpPort)}${ShopifyMcpEndpoint}`;
const ShopifyMcpClientId = "shopify-mcp";
const ShopifyMcpProcessKey = "shopify-mcp-server";
const ShopifyMcpReadinessTimeoutMs = 60_000;
const ShopifyMcpProcessStopTimeoutMs = 10_000;
const ShopifyMcpProcessStopGracePeriodMs = 2_000;
// Pin exact release tags for sandbox startup to avoid live upstream version
// resolution and the associated rate-limit / availability failures.
const ShopifyCliReleaseTag = "shopify/v0.1.0";
const ShopifyCliLinuxAmd64Sha256 =
  "f7d4c2768b0fc2ddfe3e99b49fb0cccecae9bb438541c1d4f98048bc2b36f966";

function createShopifyCliArtifact(adminBaseUrl: string): CompileBindingResult["artifacts"][number] {
  return {
    artifactKey: ShopifyCliArtifactKey,
    name: ShopifyCliArtifactName,
    env: {
      SHOPIFY_ADMIN_BASE_URL: adminBaseUrl,
    },
    lifecycle: {
      install: ({ refs }) => [
        refs.githubReleases.install({
          repository: "mistlehq/tools",
          release: {
            kind: "tag",
            match: "exact",
            tag: ShopifyCliReleaseTag,
          },
          asset: {
            kind: "exact",
            fileName: "shopify-linux-amd64",
            format: "binary",
            sha256: ShopifyCliLinuxAmd64Sha256,
          },
          installPath: refs.artifactBinPath("shopify"),
          timeoutMs: ArtifactCommandTimeoutMs,
        }),
      ],
    },
  };
}

function createShopifyMcpRuntimeClient(shopifyCliInstallPath: string): RuntimeClient {
  return {
    clientId: ShopifyMcpClientId,
    setup: {
      env: {},
      files: [],
    },
    processes: [
      {
        processKey: ShopifyMcpProcessKey,
        command: {
          args: [
            shopifyCliInstallPath,
            "mcp",
            "serve",
            "--addr",
            `${ShopifyMcpHost}:${String(ShopifyMcpPort)}`,
            "--endpoint",
            ShopifyMcpEndpoint,
          ],
        },
        readiness: {
          type: "tcp",
          host: ShopifyMcpHost,
          port: ShopifyMcpPort,
          timeoutMs: ShopifyMcpReadinessTimeoutMs,
        },
        stop: {
          signal: "sigterm",
          timeoutMs: ShopifyMcpProcessStopTimeoutMs,
          gracePeriodMs: ShopifyMcpProcessStopGracePeriodMs,
        },
      },
    ],
    endpoints: [],
  };
}

export function compileShopifyBinding(input: ShopifyCompileBindingInput): CompileBindingResult {
  const connectionConfig = ShopifyConnectionConfigSchema.parse(input.connection.config);
  const shopDomain = normalizeShopifyShopDomain(connectionConfig.shop_domain);
  const adminBaseUrl = resolveShopifyAdminBaseUrl({
    shopDomain,
    adminApiVersion: connectionConfig.admin_api_version,
  });
  const includesShopifyCli = input.binding.config.tools.includes(ShopifyToolIds.SHOPIFY_CLI);
  const includesShopifyMcp = input.binding.config.tools.includes(ShopifyToolIds.SHOPIFY_MCP);
  const includesShopifyToolArtifact = includesShopifyCli || includesShopifyMcp;
  const accessTokenSlotKey =
    connectionConfig.connection_method === ShopifyConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE
      ? ShopifyCredentialSlotKeys.OAUTH2_AUTHORIZATION_CODE_ACCESS_TOKEN
      : ShopifyCredentialSlotKeys.CUSTOM_APP_CLIENT_CREDENTIALS_ACCESS_TOKEN;

  return {
    egressRoutes: [
      {
        match: {
          hosts: [shopDomain],
          pathPrefixes: [`/admin/api/${connectionConfig.admin_api_version}`],
        },
        upstream: {
          baseUrl: adminBaseUrl,
        },
        authInjection: {
          type: "header",
          target: "x-shopify-access-token",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: input.connection.id,
          secretType: ShopifyCredentialSecretTypes.OAUTH2_ACCESS_TOKEN,
          slotKey: accessTokenSlotKey,
        },
      },
    ],
    artifacts: includesShopifyToolArtifact ? [createShopifyCliArtifact(adminBaseUrl)] : [],
    runtimeClients: includesShopifyMcp
      ? [createShopifyMcpRuntimeClient(input.refs.artifactBinPath("shopify"))]
      : [],
  };
}
