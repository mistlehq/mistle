import type {
  RuntimeArtifactGitHubReleaseInstallHelperInput,
  RuntimeArtifactInstallStep,
  RuntimeArtifactSpec,
  RuntimeExecCommand,
} from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { JiraConnectionMethodIds, JiraCredentialSlotKeys } from "./auth.js";
import { compileJiraBinding } from "./compile-binding.js";
import { JiraRequestMiddlewareIds } from "./egress-request-middleware.js";

function artifactBinPath(name: string): string {
  return `/usr/local/bin/${name}`;
}

const SandboxPaths = {
  userHomeDir: "/root",
  workspaceDir: "/root",
  runtimeDataDir: "/var/lib/mistle",
  runtimeArtifactDir: "/var/lib/mistle/artifacts",
  runtimeArtifactBinDir: "/usr/local/bin",
} as const;

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
          op: "exec",
          command: {
            args: ["mise", "install", ...input.tools],
          },
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
      targetKey: "jira-default",
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

describe("compileJiraBinding", () => {
  it("builds the expected Jira personal token egress route and optional jira artifact", () => {
    const compiled = compileJiraBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "jira-default",
      target: {
        familyId: "jira",
        variantId: "jira-default",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_personal",
        status: "active",
        config: {
          connection_method: JiraConnectionMethodIds.PERSONAL_API_TOKEN,
          site_url: "https://mistle.atlassian.net",
          email: "user@example.com",
        },
      },
      binding: {
        id: "ibd_123",
        kind: "connector",
        config: {
          tools: ["jira-cli"],
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
          hosts: ["mistle.atlassian.net"],
        },
        upstream: {
          baseUrl: "https://mistle.atlassian.net",
        },
        authInjection: {
          type: "basic",
          target: "authorization",
          username: "user@example.com",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_personal",
          secretType: "api_key",
          slotKey: JiraCredentialSlotKeys.PERSONAL_API_TOKEN_API_KEY,
        },
        requestMiddleware: [JiraRequestMiddlewareIds.APPEND_SESSION_LINK_TO_DOCUMENT],
      },
    ]);
    expect(compiled.artifacts).toHaveLength(1);
    const artifact = compiled.artifacts[0];
    expect(artifact?.artifactKey).toBe("jira-cli");
    expect(artifact?.name).toBe("Jira CLI");
    expect(artifact?.env).toEqual({
      JIRA_BASE_URL: "https://mistle.atlassian.net",
    });
    if (artifact === undefined) {
      throw new Error("Expected compiled jira artifact.");
    }
    expect(resolveArtifactLifecycleCommands(artifact)).toEqual({
      install: [
        {
          op: "github_release_install",
          repository: "mistlehq/tools",
          release: {
            kind: "tag",
            match: "exact",
            tag: "jira/v0.4.0",
          },
          asset: {
            kind: "exact",
            fileName: "jira-linux-amd64",
            format: "binary",
          },
          installPath: "/usr/local/bin/jira",
          timeoutMs: 120_000,
        },
      ],
    });
    expect(compiled.runtimeClients).toEqual([]);
  });

  it("builds the expected Jira service account token egress route and jira artifact env", () => {
    const compiled = compileJiraBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "jira-default",
      target: {
        familyId: "jira",
        variantId: "jira-default",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_service_account",
        status: "active",
        config: {
          connection_method: JiraConnectionMethodIds.SERVICE_ACCOUNT_API_TOKEN,
          cloud_id: "cloud-id-123",
        },
      },
      binding: {
        id: "ibd_123",
        kind: "connector",
        config: {
          tools: ["jira-cli"],
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
          hosts: ["api.atlassian.com"],
          pathPrefixes: ["/ex/jira/cloud-id-123"],
        },
        upstream: {
          baseUrl: "https://api.atlassian.com/ex/jira/cloud-id-123",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_service_account",
          secretType: "api_key",
          slotKey: JiraCredentialSlotKeys.SERVICE_ACCOUNT_API_TOKEN_API_KEY,
        },
        requestMiddleware: [JiraRequestMiddlewareIds.APPEND_SESSION_LINK_TO_DOCUMENT],
      },
    ]);
    expect(compiled.artifacts).toHaveLength(1);
    expect(compiled.artifacts[0]?.env).toEqual({
      JIRA_BASE_URL: "https://api.atlassian.com/ex/jira/cloud-id-123",
    });
    expect(compiled.runtimeClients).toEqual([]);
  });

  it("builds the expected Jira service account oauth client credentials egress route and jira artifact env", () => {
    const compiled = compileJiraBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "jira-default",
      target: {
        familyId: "jira",
        variantId: "jira-default",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_service_account_oauth",
        status: "active",
        config: {
          connection_method: JiraConnectionMethodIds.SERVICE_ACCOUNT_OAUTH_CLIENT_CREDENTIALS,
          cloud_id: "cloud-id-123",
          client_id: "client-id-456",
        },
      },
      binding: {
        id: "ibd_123",
        kind: "connector",
        config: {
          tools: ["jira-cli"],
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
          hosts: ["api.atlassian.com"],
          pathPrefixes: ["/ex/jira/cloud-id-123"],
        },
        upstream: {
          baseUrl: "https://api.atlassian.com/ex/jira/cloud-id-123",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_service_account_oauth",
          secretType: "oauth2_access_token",
          slotKey: JiraCredentialSlotKeys.SERVICE_ACCOUNT_OAUTH_CLIENT_CREDENTIALS_ACCESS_TOKEN,
        },
        requestMiddleware: [JiraRequestMiddlewareIds.APPEND_SESSION_LINK_TO_DOCUMENT],
      },
    ]);
    expect(compiled.artifacts).toHaveLength(1);
    expect(compiled.artifacts[0]?.env).toEqual({
      JIRA_BASE_URL: "https://api.atlassian.com/ex/jira/cloud-id-123",
    });
    expect(compiled.runtimeClients).toEqual([]);
  });
});
