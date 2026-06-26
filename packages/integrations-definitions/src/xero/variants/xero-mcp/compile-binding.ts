import {
  type CompileBindingInput,
  type CompileBindingResult,
  type RuntimeClient,
} from "@mistle/integrations-core";

import { XeroCredentialSecretTypes, XeroCredentialSlotKeys } from "./auth.js";
import type { XeroBindingConfig } from "./binding-config-schema.js";
import { XeroApiBaseUrl, type XeroTargetConfig } from "./target-config-schema.js";
import type { XeroTargetSecret } from "./target-secret-schema.js";
import { XeroToolIds } from "./tool-ids.js";

export type XeroCompileBindingInput = CompileBindingInput<
  XeroTargetConfig,
  XeroBindingConfig,
  XeroTargetSecret
>;

const XeroCliArtifactKey = "xero-cli";
const XeroCliArtifactName = "Xero CLI";
const ArtifactCommandTimeoutMs = 120_000;
export const XeroMcpHost = "127.0.0.1";
export const XeroMcpPort = 7355;
export const XeroMcpEndpoint = "/mcp";
export const XeroMcpUrl = `http://${XeroMcpHost}:${String(XeroMcpPort)}${XeroMcpEndpoint}`;
const XeroMcpClientId = "xero-mcp";
const XeroMcpProcessKey = "xero-mcp-server";
const XeroMcpReadinessTimeoutMs = 60_000;
const XeroMcpProcessStopTimeoutMs = 10_000;
const XeroMcpProcessStopGracePeriodMs = 2_000;
const XeroCliReleaseTag = "xero/v0.1.0";
const XeroCliLinuxAmd64Sha256 = "780a67e8f2d867349916fb2f1ee36e362a9c0d9553d7650c68c87c522dc8f9b7";

function createXeroCliArtifact(): CompileBindingResult["artifacts"][number] {
  return {
    artifactKey: XeroCliArtifactKey,
    name: XeroCliArtifactName,
    env: {
      XERO_API_BASE_URL: XeroApiBaseUrl,
    },
    lifecycle: {
      install: ({ refs }) => [
        refs.githubReleases.install({
          repository: "mistlehq/tools",
          release: {
            kind: "tag",
            match: "exact",
            tag: XeroCliReleaseTag,
          },
          asset: {
            kind: "exact",
            fileName: "xero-linux-amd64",
            format: "binary",
            sha256: XeroCliLinuxAmd64Sha256,
          },
          installPath: refs.artifactBinPath("xero"),
          timeoutMs: ArtifactCommandTimeoutMs,
        }),
      ],
    },
  };
}

function createXeroMcpRuntimeClient(xeroCliInstallPath: string): RuntimeClient {
  return {
    clientId: XeroMcpClientId,
    setup: {
      env: {},
      files: [],
    },
    processes: [
      {
        processKey: XeroMcpProcessKey,
        command: {
          args: [
            xeroCliInstallPath,
            "mcp",
            "serve",
            "--addr",
            `${XeroMcpHost}:${String(XeroMcpPort)}`,
            "--endpoint",
            XeroMcpEndpoint,
          ],
        },
        readiness: {
          type: "tcp",
          host: XeroMcpHost,
          port: XeroMcpPort,
          timeoutMs: XeroMcpReadinessTimeoutMs,
        },
        stop: {
          signal: "sigterm",
          timeoutMs: XeroMcpProcessStopTimeoutMs,
          gracePeriodMs: XeroMcpProcessStopGracePeriodMs,
        },
      },
    ],
    endpoints: [],
  };
}

function createXeroApiRoute(input: {
  connectionId: string;
}): CompileBindingResult["egressRoutes"][number] {
  const parsedBaseUrl = new URL(XeroApiBaseUrl);

  return {
    match: {
      hosts: [parsedBaseUrl.host],
    },
    upstream: {
      baseUrl: XeroApiBaseUrl,
    },
    authInjection: {
      type: "bearer",
      target: "authorization",
    },
    credentialResolver: {
      kind: "integration_connection",
      connectionId: input.connectionId,
      secretType: XeroCredentialSecretTypes.OAUTH2_ACCESS_TOKEN,
      slotKey: XeroCredentialSlotKeys.accessToken,
    },
  };
}

export function compileXeroBinding(input: XeroCompileBindingInput): CompileBindingResult {
  const includesXeroMcp = input.binding.config.tools.includes(XeroToolIds.XERO_MCP);

  return {
    egressRoutes: includesXeroMcp
      ? [
          createXeroApiRoute({
            connectionId: input.connection.id,
          }),
        ]
      : [],
    artifacts: includesXeroMcp ? [createXeroCliArtifact()] : [],
    runtimeClients: includesXeroMcp
      ? [createXeroMcpRuntimeClient(input.refs.artifactBinPath("xero"))]
      : [],
  };
}
