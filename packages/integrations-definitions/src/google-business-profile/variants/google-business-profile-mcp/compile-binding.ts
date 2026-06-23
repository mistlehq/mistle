import type {
  CompileBindingInput,
  CompileBindingResult,
  RuntimeClient,
} from "@mistle/integrations-core";

import {
  GoogleBusinessProfileCredentialSecretTypes,
  GoogleBusinessProfileCredentialSlotKeys,
} from "./auth.js";
import type { GoogleBusinessProfileBindingConfig } from "./binding-config-schema.js";
import type { GoogleBusinessProfileTargetConfig } from "./target-config-schema.js";
import { GoogleBusinessProfileToolIds } from "./tool-ids.js";

export type GoogleBusinessProfileCompileBindingInput = CompileBindingInput<
  GoogleBusinessProfileTargetConfig,
  GoogleBusinessProfileBindingConfig
>;

const GoogleBusinessProfileCliArtifactKey = "google-business-profile-cli";
const GoogleBusinessProfileCliArtifactName = "Google Business Profile CLI";
const ArtifactCommandTimeoutMs = 120_000;
export const GoogleBusinessProfileAccountManagementBaseUrl =
  "https://mybusinessaccountmanagement.googleapis.com";
export const GoogleBusinessProfileBusinessInformationBaseUrl =
  "https://mybusinessbusinessinformation.googleapis.com";
export const GoogleBusinessProfilePerformanceBaseUrl =
  "https://businessprofileperformance.googleapis.com";
export const GoogleBusinessProfileMyBusinessBaseUrl = "https://mybusiness.googleapis.com";
export const GoogleBusinessProfileMcpHost = "127.0.0.1";
export const GoogleBusinessProfileMcpPort = 7351;
export const GoogleBusinessProfileMcpEndpoint = "/mcp";
export const GoogleBusinessProfileMcpUrl = `http://${GoogleBusinessProfileMcpHost}:${String(
  GoogleBusinessProfileMcpPort,
)}${GoogleBusinessProfileMcpEndpoint}`;
const GoogleBusinessProfileMcpClientId = "google-business-profile-mcp";
const GoogleBusinessProfileMcpProcessKey = "google-business-profile-mcp-server";
const GoogleBusinessProfileMcpReadinessTimeoutMs = 60_000;
const GoogleBusinessProfileMcpProcessStopTimeoutMs = 10_000;
const GoogleBusinessProfileMcpProcessStopGracePeriodMs = 2_000;
// Pin exact release tags for sandbox startup to avoid live upstream version
// resolution and the associated rate-limit / availability failures.
const GoogleBusinessProfileCliReleaseTag = "gbp/v0.1.0";
const GoogleBusinessProfileCliLinuxAmd64Sha256 =
  "f8315afce769c07840f767152a3a3587f8e1b30117033b73fa135b43c6910e16";

function createGoogleBusinessProfileCliArtifact(): CompileBindingResult["artifacts"][number] {
  return {
    artifactKey: GoogleBusinessProfileCliArtifactKey,
    name: GoogleBusinessProfileCliArtifactName,
    env: {
      GBP_ACCOUNT_MANAGEMENT_BASE_URL: GoogleBusinessProfileAccountManagementBaseUrl,
      GBP_BUSINESS_INFORMATION_BASE_URL: GoogleBusinessProfileBusinessInformationBaseUrl,
      GBP_MYBUSINESS_BASE_URL: GoogleBusinessProfileMyBusinessBaseUrl,
      GBP_PERFORMANCE_BASE_URL: GoogleBusinessProfilePerformanceBaseUrl,
    },
    lifecycle: {
      install: ({ refs }) => [
        refs.githubReleases.install({
          repository: "mistlehq/tools",
          release: {
            kind: "tag",
            match: "exact",
            tag: GoogleBusinessProfileCliReleaseTag,
          },
          asset: {
            kind: "exact",
            fileName: "gbp-linux-amd64",
            format: "binary",
            sha256: GoogleBusinessProfileCliLinuxAmd64Sha256,
          },
          installPath: refs.artifactBinPath("gbp"),
          timeoutMs: ArtifactCommandTimeoutMs,
        }),
      ],
    },
  };
}

function createGoogleBusinessProfileMcpRuntimeClient(
  googleBusinessProfileCliInstallPath: string,
): RuntimeClient {
  return {
    clientId: GoogleBusinessProfileMcpClientId,
    setup: {
      env: {},
      files: [],
    },
    processes: [
      {
        processKey: GoogleBusinessProfileMcpProcessKey,
        command: {
          args: [
            googleBusinessProfileCliInstallPath,
            "mcp",
            "serve",
            "--addr",
            `${GoogleBusinessProfileMcpHost}:${String(GoogleBusinessProfileMcpPort)}`,
            "--endpoint",
            GoogleBusinessProfileMcpEndpoint,
          ],
        },
        readiness: {
          type: "tcp",
          host: GoogleBusinessProfileMcpHost,
          port: GoogleBusinessProfileMcpPort,
          timeoutMs: GoogleBusinessProfileMcpReadinessTimeoutMs,
        },
        stop: {
          signal: "sigterm",
          timeoutMs: GoogleBusinessProfileMcpProcessStopTimeoutMs,
          gracePeriodMs: GoogleBusinessProfileMcpProcessStopGracePeriodMs,
        },
      },
    ],
    endpoints: [],
  };
}

export function compileGoogleBusinessProfileBinding(
  input: GoogleBusinessProfileCompileBindingInput,
): CompileBindingResult {
  const includesGoogleBusinessProfileCli = input.binding.config.tools.includes(
    GoogleBusinessProfileToolIds.GOOGLE_BUSINESS_PROFILE_CLI,
  );
  const includesGoogleBusinessProfileMcp = input.binding.config.tools.includes(
    GoogleBusinessProfileToolIds.GOOGLE_BUSINESS_PROFILE_MCP,
  );
  const includesGoogleBusinessProfileToolArtifact =
    includesGoogleBusinessProfileCli || includesGoogleBusinessProfileMcp;

  return {
    egressRoutes: [
      {
        match: {
          hosts: ["mybusinessaccountmanagement.googleapis.com"],
        },
        upstream: {
          baseUrl: GoogleBusinessProfileAccountManagementBaseUrl,
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: input.connection.id,
          secretType: GoogleBusinessProfileCredentialSecretTypes.OAUTH2_ACCESS_TOKEN,
          slotKey: GoogleBusinessProfileCredentialSlotKeys.accessToken,
        },
      },
      {
        match: {
          hosts: ["mybusinessbusinessinformation.googleapis.com"],
        },
        upstream: {
          baseUrl: GoogleBusinessProfileBusinessInformationBaseUrl,
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: input.connection.id,
          secretType: GoogleBusinessProfileCredentialSecretTypes.OAUTH2_ACCESS_TOKEN,
          slotKey: GoogleBusinessProfileCredentialSlotKeys.accessToken,
        },
      },
      {
        match: {
          hosts: ["businessprofileperformance.googleapis.com"],
        },
        upstream: {
          baseUrl: GoogleBusinessProfilePerformanceBaseUrl,
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: input.connection.id,
          secretType: GoogleBusinessProfileCredentialSecretTypes.OAUTH2_ACCESS_TOKEN,
          slotKey: GoogleBusinessProfileCredentialSlotKeys.accessToken,
        },
      },
      {
        match: {
          hosts: ["mybusiness.googleapis.com"],
        },
        upstream: {
          baseUrl: GoogleBusinessProfileMyBusinessBaseUrl,
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: input.connection.id,
          secretType: GoogleBusinessProfileCredentialSecretTypes.OAUTH2_ACCESS_TOKEN,
          slotKey: GoogleBusinessProfileCredentialSlotKeys.accessToken,
        },
      },
    ],
    artifacts: includesGoogleBusinessProfileToolArtifact
      ? [createGoogleBusinessProfileCliArtifact()]
      : [],
    runtimeClients: includesGoogleBusinessProfileMcp
      ? [createGoogleBusinessProfileMcpRuntimeClient(input.refs.artifactBinPath("gbp"))]
      : [],
  };
}
