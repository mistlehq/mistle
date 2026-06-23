import type {
  CompileBindingInput,
  CompileBindingResult,
  RuntimeClient,
} from "@mistle/integrations-core";

import {
  GoogleSearchConsoleCredentialSecretTypes,
  GoogleSearchConsoleCredentialSlotKeys,
} from "./auth.js";
import type { GoogleSearchConsoleBindingConfig } from "./binding-config-schema.js";
import type { GoogleSearchConsoleTargetConfig } from "./target-config-schema.js";
import { GoogleSearchConsoleToolIds } from "./tool-ids.js";

export type GoogleSearchConsoleCompileBindingInput = CompileBindingInput<
  GoogleSearchConsoleTargetConfig,
  GoogleSearchConsoleBindingConfig
>;

const GoogleSearchConsoleCliArtifactKey = "google-search-console-cli";
const GoogleSearchConsoleCliArtifactName = "Google Search Console CLI";
const ArtifactCommandTimeoutMs = 120_000;
export const GoogleSearchConsoleBaseUrl = "https://searchconsole.googleapis.com";
export const GoogleSearchConsoleMcpHost = "127.0.0.1";
export const GoogleSearchConsoleMcpPort = 7349;
export const GoogleSearchConsoleMcpEndpoint = "/mcp";
export const GoogleSearchConsoleMcpUrl = `http://${GoogleSearchConsoleMcpHost}:${String(
  GoogleSearchConsoleMcpPort,
)}${GoogleSearchConsoleMcpEndpoint}`;
const GoogleSearchConsoleMcpClientId = "google-search-console-mcp";
const GoogleSearchConsoleMcpProcessKey = "google-search-console-mcp-server";
const GoogleSearchConsoleMcpReadinessTimeoutMs = 60_000;
const GoogleSearchConsoleMcpProcessStopTimeoutMs = 10_000;
const GoogleSearchConsoleMcpProcessStopGracePeriodMs = 2_000;
// Pin exact release tags for sandbox startup to avoid live upstream version
// resolution and the associated rate-limit / availability failures.
const GoogleSearchConsoleCliReleaseTag = "gsc/v0.1.0";
const GoogleSearchConsoleCliLinuxAmd64Sha256 =
  "f98c3a993a23e05987d064c8e27004c28eb56e1e47cfbc93a689cd2a70e588f8";

function createGoogleSearchConsoleCliArtifact(): CompileBindingResult["artifacts"][number] {
  return {
    artifactKey: GoogleSearchConsoleCliArtifactKey,
    name: GoogleSearchConsoleCliArtifactName,
    env: {
      GSC_SEARCH_CONSOLE_BASE_URL: GoogleSearchConsoleBaseUrl,
    },
    lifecycle: {
      install: ({ refs }) => [
        refs.githubReleases.install({
          repository: "mistlehq/tools",
          release: {
            kind: "tag",
            match: "exact",
            tag: GoogleSearchConsoleCliReleaseTag,
          },
          asset: {
            kind: "exact",
            fileName: "gsc-linux-amd64",
            format: "binary",
            sha256: GoogleSearchConsoleCliLinuxAmd64Sha256,
          },
          installPath: refs.artifactBinPath("gsc"),
          timeoutMs: ArtifactCommandTimeoutMs,
        }),
      ],
    },
  };
}

function createGoogleSearchConsoleMcpRuntimeClient(
  googleSearchConsoleCliInstallPath: string,
): RuntimeClient {
  return {
    clientId: GoogleSearchConsoleMcpClientId,
    setup: {
      env: {},
      files: [],
    },
    processes: [
      {
        processKey: GoogleSearchConsoleMcpProcessKey,
        command: {
          args: [
            googleSearchConsoleCliInstallPath,
            "mcp",
            "serve",
            "--addr",
            `${GoogleSearchConsoleMcpHost}:${String(GoogleSearchConsoleMcpPort)}`,
            "--endpoint",
            GoogleSearchConsoleMcpEndpoint,
          ],
        },
        readiness: {
          type: "tcp",
          host: GoogleSearchConsoleMcpHost,
          port: GoogleSearchConsoleMcpPort,
          timeoutMs: GoogleSearchConsoleMcpReadinessTimeoutMs,
        },
        stop: {
          signal: "sigterm",
          timeoutMs: GoogleSearchConsoleMcpProcessStopTimeoutMs,
          gracePeriodMs: GoogleSearchConsoleMcpProcessStopGracePeriodMs,
        },
      },
    ],
    endpoints: [],
  };
}

export function compileGoogleSearchConsoleBinding(
  input: GoogleSearchConsoleCompileBindingInput,
): CompileBindingResult {
  const includesGoogleSearchConsoleCli = input.binding.config.tools.includes(
    GoogleSearchConsoleToolIds.GOOGLE_SEARCH_CONSOLE_CLI,
  );
  const includesGoogleSearchConsoleMcp = input.binding.config.tools.includes(
    GoogleSearchConsoleToolIds.GOOGLE_SEARCH_CONSOLE_MCP,
  );
  const includesGoogleSearchConsoleToolArtifact =
    includesGoogleSearchConsoleCli || includesGoogleSearchConsoleMcp;

  return {
    egressRoutes: [
      {
        match: {
          hosts: ["searchconsole.googleapis.com"],
        },
        upstream: {
          baseUrl: GoogleSearchConsoleBaseUrl,
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: input.connection.id,
          secretType: GoogleSearchConsoleCredentialSecretTypes.OAUTH2_ACCESS_TOKEN,
          slotKey: GoogleSearchConsoleCredentialSlotKeys.accessToken,
        },
      },
    ],
    artifacts: includesGoogleSearchConsoleToolArtifact
      ? [createGoogleSearchConsoleCliArtifact()]
      : [],
    runtimeClients: includesGoogleSearchConsoleMcp
      ? [createGoogleSearchConsoleMcpRuntimeClient(input.refs.artifactBinPath("gsc"))]
      : [],
  };
}
