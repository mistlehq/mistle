import type {
  CompileBindingInput,
  CompileBindingResult,
  EgressCredentialResolverRef,
  RuntimeClient,
} from "@mistle/integrations-core";

import { compileRemoteMcpServerEgressRoutes } from "../../../shared/remote-mcp-server-catalog/index.js";
import { GoogleWorkspaceCredentialSecretTypes, GoogleWorkspaceCredentialSlotKeys } from "./auth.js";
import type { GoogleWorkspaceBindingConfig } from "./binding-config-schema.js";
import {
  GoogleWorkspaceLocalGwsToolIds,
  type GoogleWorkspaceMcpServerId,
  GoogleWorkspaceRemoteMcpServerCatalog,
} from "./mcp-catalog.js";
import type { GoogleWorkspaceTargetConfig } from "./target-config-schema.js";

export type GoogleWorkspaceCompileBindingInput = CompileBindingInput<
  GoogleWorkspaceTargetConfig,
  GoogleWorkspaceBindingConfig
>;

const GoogleWorkspaceGwsArtifactKey = "google-workspace-cli";
const GoogleWorkspaceGwsArtifactName = "Google Workspace CLI";
const ArtifactCommandTimeoutMs = 120_000;
export const GoogleWorkspaceDriveBaseUrl = "https://www.googleapis.com/drive/v3";
export const GoogleWorkspaceSheetsBaseUrl = "https://sheets.googleapis.com/v4";
export const GoogleWorkspaceDocsBaseUrl = "https://docs.googleapis.com/v1";
export const GoogleWorkspaceSlidesBaseUrl = "https://slides.googleapis.com/v1";
export const GoogleWorkspaceGwsMcpHost = "127.0.0.1";
export const GoogleWorkspaceGwsMcpPort = 7353;
export const GoogleWorkspaceGwsMcpEndpoint = "/mcp";
export const GoogleWorkspaceGwsMcpUrl = `http://${GoogleWorkspaceGwsMcpHost}:${String(
  GoogleWorkspaceGwsMcpPort,
)}${GoogleWorkspaceGwsMcpEndpoint}`;
const GoogleWorkspaceGwsMcpClientId = "google-workspace-gws-mcp";
const GoogleWorkspaceGwsMcpProcessKey = "google-workspace-gws-mcp-server";
const GoogleWorkspaceGwsMcpReadinessTimeoutMs = 60_000;
const GoogleWorkspaceGwsMcpProcessStopTimeoutMs = 10_000;
const GoogleWorkspaceGwsMcpProcessStopGracePeriodMs = 2_000;
// Pin exact release tags for sandbox startup to avoid live upstream version
// resolution and the associated rate-limit / availability failures.
const GoogleWorkspaceGwsReleaseTag = "gws/v0.1.0";
const GoogleWorkspaceGwsLinuxAmd64Sha256 =
  "43e7fe1759966e3910a74cfbf69d90fa6b12fa1e44ffb29c69e95191152d13f4";

function createGoogleWorkspaceCredentialResolver(input: {
  connectionId: string;
}): EgressCredentialResolverRef {
  return {
    kind: "integration_connection",
    connectionId: input.connectionId,
    secretType: GoogleWorkspaceCredentialSecretTypes.OAUTH2_ACCESS_TOKEN,
    slotKey: GoogleWorkspaceCredentialSlotKeys.accessToken,
  };
}

function createGoogleWorkspaceGwsArtifact(): CompileBindingResult["artifacts"][number] {
  return {
    artifactKey: GoogleWorkspaceGwsArtifactKey,
    name: GoogleWorkspaceGwsArtifactName,
    env: {
      GWS_DOCS_BASE_URL: GoogleWorkspaceDocsBaseUrl,
      GWS_DRIVE_BASE_URL: GoogleWorkspaceDriveBaseUrl,
      GWS_SHEETS_BASE_URL: GoogleWorkspaceSheetsBaseUrl,
      GWS_SLIDES_BASE_URL: GoogleWorkspaceSlidesBaseUrl,
    },
    lifecycle: {
      install: ({ refs }) => [
        refs.githubReleases.install({
          repository: "mistlehq/tools",
          release: {
            kind: "tag",
            match: "exact",
            tag: GoogleWorkspaceGwsReleaseTag,
          },
          asset: {
            kind: "exact",
            fileName: "gws-linux-amd64",
            format: "binary",
            sha256: GoogleWorkspaceGwsLinuxAmd64Sha256,
          },
          installPath: refs.artifactBinPath("gws"),
          timeoutMs: ArtifactCommandTimeoutMs,
        }),
      ],
    },
  };
}

function createGoogleWorkspaceGwsMcpRuntimeClient(input: {
  gwsInstallPath: string;
  selectedTools: ReadonlyArray<GoogleWorkspaceMcpServerId>;
}): RuntimeClient {
  return {
    clientId: GoogleWorkspaceGwsMcpClientId,
    setup: {
      env: {},
      files: [],
    },
    processes: [
      {
        processKey: GoogleWorkspaceGwsMcpProcessKey,
        command: {
          args: [
            input.gwsInstallPath,
            "mcp",
            "serve",
            "--addr",
            `${GoogleWorkspaceGwsMcpHost}:${String(GoogleWorkspaceGwsMcpPort)}`,
            "--endpoint",
            GoogleWorkspaceGwsMcpEndpoint,
            "--tools",
            input.selectedTools.join(","),
          ],
        },
        readiness: {
          type: "tcp",
          host: GoogleWorkspaceGwsMcpHost,
          port: GoogleWorkspaceGwsMcpPort,
          timeoutMs: GoogleWorkspaceGwsMcpReadinessTimeoutMs,
        },
        stop: {
          signal: "sigterm",
          timeoutMs: GoogleWorkspaceGwsMcpProcessStopTimeoutMs,
          gracePeriodMs: GoogleWorkspaceGwsMcpProcessStopGracePeriodMs,
        },
      },
    ],
    endpoints: [],
  };
}

function resolveSelectedLocalGwsTools(
  selectedIds: ReadonlyArray<string>,
): ReadonlyArray<GoogleWorkspaceMcpServerId> {
  const selectedIdSet = new Set(selectedIds);
  return GoogleWorkspaceLocalGwsToolIds.filter((toolId) => selectedIdSet.has(toolId));
}

function resolveSelectedRemoteMcpServerIds(
  selectedIds: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const selectedIdSet = new Set(selectedIds);
  return GoogleWorkspaceRemoteMcpServerCatalog.filter((entry) => selectedIdSet.has(entry.id)).map(
    (entry) => entry.id,
  );
}

function createGoogleWorkspaceGwsEgressRoutes(input: {
  credentialResolver: EgressCredentialResolverRef;
  selectedTools: ReadonlyArray<GoogleWorkspaceMcpServerId>;
}): CompileBindingResult["egressRoutes"] {
  return input.selectedTools.map((toolId) => {
    if (toolId === "drive") {
      return {
        match: {
          hosts: ["www.googleapis.com"],
        },
        upstream: {
          baseUrl: GoogleWorkspaceDriveBaseUrl,
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: input.credentialResolver,
      };
    }

    if (toolId === "sheets") {
      return {
        match: {
          hosts: ["sheets.googleapis.com"],
        },
        upstream: {
          baseUrl: GoogleWorkspaceSheetsBaseUrl,
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: input.credentialResolver,
      };
    }

    if (toolId === "docs") {
      return {
        match: {
          hosts: ["docs.googleapis.com"],
        },
        upstream: {
          baseUrl: GoogleWorkspaceDocsBaseUrl,
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: input.credentialResolver,
      };
    }

    if (toolId === "slides") {
      return {
        match: {
          hosts: ["slides.googleapis.com"],
        },
        upstream: {
          baseUrl: GoogleWorkspaceSlidesBaseUrl,
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: input.credentialResolver,
      };
    }

    throw new Error(`Unsupported local Google Workspace tool id '${toolId}'.`);
  });
}

export function compileGoogleWorkspaceBinding(
  input: GoogleWorkspaceCompileBindingInput,
): CompileBindingResult {
  const credentialResolver = createGoogleWorkspaceCredentialResolver({
    connectionId: input.connection.id,
  });
  const selectedLocalGwsTools = resolveSelectedLocalGwsTools(input.binding.config.mcpServers);
  const includesLocalGwsMcp = selectedLocalGwsTools.length > 0;

  return {
    egressRoutes: [
      ...compileRemoteMcpServerEgressRoutes({
        catalog: GoogleWorkspaceRemoteMcpServerCatalog,
        selectedIds: resolveSelectedRemoteMcpServerIds(input.binding.config.mcpServers),
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver,
      }),
      ...(includesLocalGwsMcp
        ? createGoogleWorkspaceGwsEgressRoutes({
            credentialResolver,
            selectedTools: selectedLocalGwsTools,
          })
        : []),
    ],
    artifacts: includesLocalGwsMcp ? [createGoogleWorkspaceGwsArtifact()] : [],
    runtimeClients: includesLocalGwsMcp
      ? [
          createGoogleWorkspaceGwsMcpRuntimeClient({
            gwsInstallPath: input.refs.artifactBinPath("gws"),
            selectedTools: selectedLocalGwsTools,
          }),
        ]
      : [],
  };
}
