import type {
  CompileBindingInput,
  CompileBindingResult,
  EgressCredentialResolverRef,
  RuntimeClient,
} from "@mistle/integrations-core";

import { GoogleWorkspaceCredentialSecretTypes, GoogleWorkspaceCredentialSlotKeys } from "./auth.js";
import type { GoogleWorkspaceBindingConfig } from "./binding-config-schema.js";
import { GoogleWorkspaceLocalGwsToolIds, type GoogleWorkspaceMcpServerId } from "./mcp-catalog.js";
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
export const GoogleWorkspaceGmailBaseUrl = "https://gmail.googleapis.com/gmail/v1";
export const GoogleWorkspaceCalendarBaseUrl = "https://www.googleapis.com/calendar/v3";
export const GoogleWorkspaceChatBaseUrl = "https://chat.googleapis.com/v1";
export const GoogleWorkspacePeopleBaseUrl = "https://people.googleapis.com/v1";
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
const GoogleWorkspaceGwsReleaseTag = "gws/v0.2.0";
const GoogleWorkspaceGwsLinuxAmd64Sha256 =
  "7e9f037c7e03f868c101a4412f8dd48ad3fc70acdc1ff4af3a2b1baecdac50fe";

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
      GWS_GMAIL_BASE_URL: GoogleWorkspaceGmailBaseUrl,
      GWS_CALENDAR_BASE_URL: GoogleWorkspaceCalendarBaseUrl,
      GWS_CHAT_BASE_URL: GoogleWorkspaceChatBaseUrl,
      GWS_PEOPLE_BASE_URL: GoogleWorkspacePeopleBaseUrl,
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

function createGoogleWorkspaceGwsEgressRoutes(input: {
  credentialResolver: EgressCredentialResolverRef;
  selectedTools: ReadonlyArray<GoogleWorkspaceMcpServerId>;
}): CompileBindingResult["egressRoutes"] {
  return input.selectedTools.map((toolId) => {
    if (toolId === "gmail") {
      return {
        match: {
          hosts: ["gmail.googleapis.com"],
          pathPrefixes: ["/gmail/v1"],
        },
        upstream: {
          baseUrl: GoogleWorkspaceGmailBaseUrl,
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: input.credentialResolver,
      };
    }

    if (toolId === "drive") {
      return {
        match: {
          hosts: ["www.googleapis.com"],
          pathPrefixes: ["/drive/v3"],
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
          pathPrefixes: ["/v4"],
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
          pathPrefixes: ["/v1"],
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
          pathPrefixes: ["/v1"],
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

    if (toolId === "calendar") {
      return {
        match: {
          hosts: ["www.googleapis.com"],
          pathPrefixes: ["/calendar/v3"],
        },
        upstream: {
          baseUrl: GoogleWorkspaceCalendarBaseUrl,
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: input.credentialResolver,
      };
    }

    if (toolId === "chat") {
      return {
        match: {
          hosts: ["chat.googleapis.com"],
          pathPrefixes: ["/v1"],
        },
        upstream: {
          baseUrl: GoogleWorkspaceChatBaseUrl,
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: input.credentialResolver,
      };
    }

    if (toolId === "people") {
      return {
        match: {
          hosts: ["people.googleapis.com"],
          pathPrefixes: ["/v1"],
        },
        upstream: {
          baseUrl: GoogleWorkspacePeopleBaseUrl,
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: input.credentialResolver,
      };
    }

    throw new Error("Unsupported local Google Workspace tool id.");
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
