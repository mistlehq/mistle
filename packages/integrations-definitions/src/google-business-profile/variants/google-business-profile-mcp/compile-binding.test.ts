import type {
  RuntimeArtifactGitHubReleaseInstallHelperInput,
  RuntimeArtifactInstallStep,
  RuntimeArtifactSpec,
  RuntimeExecCommand,
  SandboxPathRefs,
} from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import {
  GoogleBusinessProfileCredentialSecretTypes,
  GoogleBusinessProfileCredentialSlotKeys,
} from "./auth.js";
import { compileGoogleBusinessProfileBinding } from "./compile-binding.js";
import { GoogleBusinessProfileToolIds } from "./tool-ids.js";

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
      targetKey: "google-business-profile-mcp",
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

describe("compileGoogleBusinessProfileBinding", () => {
  it("builds managed egress routes and the pinned Google Business Profile CLI artifact", () => {
    const compiled = compileGoogleBusinessProfileBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "google-business-profile-mcp",
      target: {
        familyId: "google-business-profile",
        variantId: "google-business-profile-mcp",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_google_business_profile",
        status: "active",
        config: {
          connection_method: "oauth2-authorization-code",
          client_id: "google-client.apps.googleusercontent.com",
        },
      },
      binding: {
        id: "ibd_123",
        kind: "connector",
        config: {
          tools: [GoogleBusinessProfileToolIds.GOOGLE_BUSINESS_PROFILE_CLI],
        },
      },
      refs: {
        sandboxPaths: SandboxPaths,
        artifactBinPath,
      },
    });

    expect(compiled.egressRoutes).toEqual([
      {
        match: {
          hosts: ["mybusinessaccountmanagement.googleapis.com"],
        },
        upstream: {
          baseUrl: "https://mybusinessaccountmanagement.googleapis.com",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_google_business_profile",
          secretType: GoogleBusinessProfileCredentialSecretTypes.OAUTH2_ACCESS_TOKEN,
          slotKey: GoogleBusinessProfileCredentialSlotKeys.accessToken,
        },
      },
      {
        match: {
          hosts: ["mybusinessbusinessinformation.googleapis.com"],
        },
        upstream: {
          baseUrl: "https://mybusinessbusinessinformation.googleapis.com",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_google_business_profile",
          secretType: GoogleBusinessProfileCredentialSecretTypes.OAUTH2_ACCESS_TOKEN,
          slotKey: GoogleBusinessProfileCredentialSlotKeys.accessToken,
        },
      },
      {
        match: {
          hosts: ["businessprofileperformance.googleapis.com"],
        },
        upstream: {
          baseUrl: "https://businessprofileperformance.googleapis.com",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_google_business_profile",
          secretType: GoogleBusinessProfileCredentialSecretTypes.OAUTH2_ACCESS_TOKEN,
          slotKey: GoogleBusinessProfileCredentialSlotKeys.accessToken,
        },
      },
      {
        match: {
          hosts: ["mybusiness.googleapis.com"],
        },
        upstream: {
          baseUrl: "https://mybusiness.googleapis.com",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_google_business_profile",
          secretType: GoogleBusinessProfileCredentialSecretTypes.OAUTH2_ACCESS_TOKEN,
          slotKey: GoogleBusinessProfileCredentialSlotKeys.accessToken,
        },
      },
    ]);

    expect(compiled.artifacts).toHaveLength(1);
    const artifact = compiled.artifacts[0];
    expect(artifact?.artifactKey).toBe("google-business-profile-cli");
    expect(artifact?.name).toBe("Google Business Profile CLI");
    expect(artifact?.env).toEqual({
      GBP_ACCOUNT_MANAGEMENT_BASE_URL: "https://mybusinessaccountmanagement.googleapis.com",
      GBP_BUSINESS_INFORMATION_BASE_URL: "https://mybusinessbusinessinformation.googleapis.com",
      GBP_MYBUSINESS_BASE_URL: "https://mybusiness.googleapis.com",
      GBP_PERFORMANCE_BASE_URL: "https://businessprofileperformance.googleapis.com",
    });
    if (artifact === undefined) {
      throw new Error("Expected compiled Google Business Profile CLI artifact.");
    }
    expect(resolveArtifactLifecycleCommands(artifact)).toEqual({
      install: [
        {
          op: "github_release_install",
          repository: "mistlehq/tools",
          release: {
            kind: "tag",
            match: "exact",
            tag: "gbp/v0.1.0",
          },
          asset: {
            kind: "exact",
            fileName: "gbp-linux-amd64",
            format: "binary",
            sha256: "f8315afce769c07840f767152a3a3587f8e1b30117033b73fa135b43c6910e16",
          },
          installPath: "/usr/local/bin/gbp",
          timeoutMs: 120_000,
        },
      ],
    });
    expect(compiled.runtimeClients).toEqual([]);
  });

  it("installs the Google Business Profile binary and starts a local MCP server when MCP is selected", () => {
    const compiled = compileGoogleBusinessProfileBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "google-business-profile-mcp",
      target: {
        familyId: "google-business-profile",
        variantId: "google-business-profile-mcp",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_google_business_profile",
        status: "active",
        config: {
          connection_method: "oauth2-authorization-code",
          client_id: "google-client.apps.googleusercontent.com",
        },
      },
      binding: {
        id: "ibd_123",
        kind: "connector",
        config: {
          tools: [GoogleBusinessProfileToolIds.GOOGLE_BUSINESS_PROFILE_MCP],
        },
      },
      refs: {
        sandboxPaths: SandboxPaths,
        artifactBinPath,
      },
    });

    expect(compiled.artifacts).toHaveLength(1);
    expect(compiled.artifacts[0]?.artifactKey).toBe("google-business-profile-cli");
    expect(compiled.runtimeClients).toEqual([
      {
        clientId: "google-business-profile-mcp",
        setup: {
          env: {},
          files: [],
        },
        processes: [
          {
            processKey: "google-business-profile-mcp-server",
            command: {
              args: [
                "/usr/local/bin/gbp",
                "mcp",
                "serve",
                "--addr",
                "127.0.0.1:7351",
                "--endpoint",
                "/mcp",
              ],
            },
            readiness: {
              type: "tcp",
              host: "127.0.0.1",
              port: 7351,
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

  it("omits the Google Business Profile artifact and runtime client when no tools are selected", () => {
    const compiled = compileGoogleBusinessProfileBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "google-business-profile-mcp",
      target: {
        familyId: "google-business-profile",
        variantId: "google-business-profile-mcp",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_google_business_profile",
        status: "active",
        config: {
          connection_method: "oauth2-authorization-code",
          client_id: "google-client.apps.googleusercontent.com",
        },
      },
      binding: {
        id: "ibd_123",
        kind: "connector",
        config: {
          tools: [],
        },
      },
      refs: {
        sandboxPaths: SandboxPaths,
        artifactBinPath,
      },
    });

    expect(compiled.egressRoutes).toHaveLength(4);
    expect(compiled.artifacts).toEqual([]);
    expect(compiled.runtimeClients).toEqual([]);
  });
});
