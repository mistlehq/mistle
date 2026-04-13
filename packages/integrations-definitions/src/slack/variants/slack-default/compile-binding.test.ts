import type {
  RuntimeArtifactGitHubReleaseInstallHelperInput,
  RuntimeArtifactInstallStep,
  RuntimeArtifactSpec,
  RuntimeExecCommand,
} from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import {
  SlackBotTokenConnectionMethodId,
  SlackBotTokenSlotKey,
  SlackCredentialSecretTypes,
} from "./auth.js";
import { compileSlackBinding } from "./compile-binding.js";
import { SlackCliToolId } from "./tool-ids.js";

function artifactBinPath(name: string): string {
  return `/usr/local/bin/${name}`;
}

const SandboxPaths = {
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
      targetKey: "slack-default",
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

describe("compileSlackBinding", () => {
  it("builds the expected Slack egress route and optional CLI artifact", () => {
    const compiled = compileSlackBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "slack-default",
      target: {
        familyId: "slack",
        variantId: "slack-default",
        enabled: true,
        config: {
          apiBaseUrl: "https://slack.com/api",
        },
        secrets: {},
      },
      connection: {
        id: "icn_slack",
        status: "active",
        config: {
          connection_method: SlackBotTokenConnectionMethodId,
        },
      },
      binding: {
        id: "ibd_123",
        kind: "connector",
        config: {
          tools: [SlackCliToolId],
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
          hosts: ["slack.com"],
          pathPrefixes: ["/api"],
        },
        upstream: {
          baseUrl: "https://slack.com/api",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          connectionId: "icn_slack",
          secretType: SlackCredentialSecretTypes.API_KEY,
          slotKey: SlackBotTokenSlotKey,
        },
      },
    ]);

    expect(compiled.artifacts).toHaveLength(1);
    const artifact = compiled.artifacts[0];
    expect(artifact?.artifactKey).toBe("slack-cli");
    expect(artifact?.name).toBe("Slack CLI");
    expect(artifact?.env).toEqual({
      SLACK_BASE_URL: "https://slack.com/api",
    });
    if (artifact === undefined) {
      throw new Error("Expected compiled Slack CLI artifact.");
    }
    expect(resolveArtifactLifecycleCommands(artifact)).toEqual({
      install: [
        {
          op: "github_release_install",
          repository: "mistlehq/tools",
          release: {
            kind: "tag",
            match: "latest_matching_prefix",
            prefix: "slack/",
          },
          asset: {
            kind: "exact",
            fileName: "slack-linux-amd64",
            format: "binary",
          },
          installPath: "/usr/local/bin/slack",
          timeoutMs: 120_000,
        },
      ],
    });
    expect(compiled.runtimeClients).toEqual([]);
  });

  it("omits the Slack CLI artifact when the tool is not selected", () => {
    const compiled = compileSlackBinding({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "slack-default",
      target: {
        familyId: "slack",
        variantId: "slack-default",
        enabled: true,
        config: {
          apiBaseUrl: "https://slack.com/api",
        },
        secrets: {},
      },
      connection: {
        id: "icn_slack",
        status: "active",
        config: {
          connection_method: SlackBotTokenConnectionMethodId,
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

    expect(compiled.artifacts).toEqual([]);
  });
});
