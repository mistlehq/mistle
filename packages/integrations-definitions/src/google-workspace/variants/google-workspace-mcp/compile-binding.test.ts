import {
  routesOverlap,
  type EgressCredentialRoute,
  type RuntimeArtifactGitHubReleaseInstallHelperInput,
  type RuntimeArtifactInstallStep,
  type RuntimeArtifactSpec,
  type RuntimeExecCommand,
} from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { GoogleWorkspaceCredentialSlotKeys } from "./auth.js";
import { compileGoogleWorkspaceBinding } from "./compile-binding.js";
import { GoogleWorkspaceMcpServerIds } from "./mcp-catalog.js";

const SandboxPaths = {
  userHomeDir: "/root",
  workspaceDir: "/root",
  runtimeDataDir: "/var/lib/mistle",
  runtimeArtifactDir: "/var/lib/mistle/artifacts",
  runtimeArtifactBinDir: "/usr/local/bin",
};

function artifactBinPath(name: string): string {
  return `/usr/local/bin/${name}`;
}

function resolveArtifactLifecycleCommands(artifact: RuntimeArtifactSpec): {
  install: ReadonlyArray<RuntimeArtifactInstallStep>;
} {
  const install =
    typeof artifact.lifecycle.install === "function"
      ? artifact.lifecycle.install({
          refs: {
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
              install(
                input: RuntimeArtifactGitHubReleaseInstallHelperInput,
              ): RuntimeArtifactInstallStep {
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
              targetKey: "google-workspace-mcp",
              bindingId: "ibd_123",
            },
          },
        })
      : artifact.lifecycle.install;

  return {
    install,
  };
}

function createCompileInput(input: {
  mcpServers: Array<(typeof GoogleWorkspaceMcpServerIds)[keyof typeof GoogleWorkspaceMcpServerIds]>;
}): Parameters<typeof compileGoogleWorkspaceBinding>[0] {
  return {
    organizationId: "org_123",
    sandboxProfileId: "sbp_123",
    version: 1,
    targetKey: "google-workspace-mcp",
    target: {
      familyId: "google-workspace",
      variantId: "google-workspace-mcp",
      enabled: true,
      config: {},
      secrets: {},
    },
    connection: {
      id: "icn_google_workspace",
      status: "active",
      config: {
        connection_method: "oauth2-authorization-code",
        client_id: "google_client_123.apps.googleusercontent.com",
      },
    },
    binding: {
      id: "ibd_123",
      kind: "connector",
      config: {
        mcpServers: input.mcpServers,
      },
    },
    refs: {
      sandboxPaths: SandboxPaths,
      artifactBinPath,
    },
  };
}

describe("compileGoogleWorkspaceBinding", () => {
  it("installs gws and starts a filtered local MCP server for Gmail", () => {
    const compiled = compileGoogleWorkspaceBinding(
      createCompileInput({
        mcpServers: [GoogleWorkspaceMcpServerIds.GMAIL],
      }),
    );

    expect(compiled.egressRoutes).toEqual([
      {
        match: {
          hosts: ["gmail.googleapis.com"],
          pathPrefixes: ["/gmail/v1"],
        },
        upstream: {
          baseUrl: "https://gmail.googleapis.com/gmail/v1",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_google_workspace",
          secretType: "oauth2_access_token",
          slotKey: GoogleWorkspaceCredentialSlotKeys.accessToken,
        },
      },
    ]);
    expect(compiled.artifacts).toHaveLength(1);
    expect(compiled.runtimeClients[0]?.processes[0]?.command.args).toContain("gmail");
  });

  it("installs gws and starts a filtered local MCP server for Drive, Sheets, Docs, and Slides", () => {
    const compiled = compileGoogleWorkspaceBinding(
      createCompileInput({
        mcpServers: [
          GoogleWorkspaceMcpServerIds.DRIVE,
          GoogleWorkspaceMcpServerIds.SHEETS,
          GoogleWorkspaceMcpServerIds.DOCS,
          GoogleWorkspaceMcpServerIds.SLIDES,
        ],
      }),
    );

    expect(compiled.egressRoutes.map((route) => route.upstream.baseUrl)).toEqual([
      "https://www.googleapis.com/drive/v3",
      "https://sheets.googleapis.com/v4",
      "https://docs.googleapis.com/v1",
      "https://slides.googleapis.com/v1",
    ]);
    expect(compiled.egressRoutes.map((route) => route.match)).toEqual([
      {
        hosts: ["www.googleapis.com"],
        pathPrefixes: ["/drive/v3"],
      },
      {
        hosts: ["sheets.googleapis.com"],
        pathPrefixes: ["/v4"],
      },
      {
        hosts: ["docs.googleapis.com"],
        pathPrefixes: ["/v1"],
      },
      {
        hosts: ["slides.googleapis.com"],
        pathPrefixes: ["/v1"],
      },
    ]);
    expect(compiled.artifacts).toHaveLength(1);
    const artifact = compiled.artifacts[0];
    expect(artifact?.artifactKey).toBe("google-workspace-cli");
    expect(artifact?.name).toBe("Google Workspace CLI");
    expect(artifact?.env).toEqual({
      GWS_CALENDAR_BASE_URL: "https://www.googleapis.com/calendar/v3",
      GWS_CHAT_BASE_URL: "https://chat.googleapis.com/v1",
      GWS_DOCS_BASE_URL: "https://docs.googleapis.com/v1",
      GWS_DRIVE_BASE_URL: "https://www.googleapis.com/drive/v3",
      GWS_GMAIL_BASE_URL: "https://gmail.googleapis.com/gmail/v1",
      GWS_PEOPLE_BASE_URL: "https://people.googleapis.com/v1",
      GWS_SHEETS_BASE_URL: "https://sheets.googleapis.com/v4",
      GWS_SLIDES_BASE_URL: "https://slides.googleapis.com/v1",
    });
    if (artifact === undefined) {
      throw new Error("Expected compiled Google Workspace CLI artifact.");
    }
    expect(resolveArtifactLifecycleCommands(artifact)).toEqual({
      install: [
        {
          op: "github_release_install",
          repository: "mistlehq/tools",
          release: {
            kind: "tag",
            match: "exact",
            tag: "gws/v0.2.0",
          },
          asset: {
            kind: "exact",
            fileName: "gws-linux-amd64",
            format: "binary",
            sha256: "7e9f037c7e03f868c101a4412f8dd48ad3fc70acdc1ff4af3a2b1baecdac50fe",
          },
          installPath: "/usr/local/bin/gws",
          timeoutMs: 120_000,
        },
      ],
    });
    expect(compiled.runtimeClients).toEqual([
      {
        clientId: "google-workspace-gws-mcp",
        setup: {
          env: {},
          files: [],
        },
        processes: [
          {
            processKey: "google-workspace-gws-mcp-server",
            command: {
              args: [
                "/usr/local/bin/gws",
                "mcp",
                "serve",
                "--addr",
                "127.0.0.1:7353",
                "--endpoint",
                "/mcp",
                "--tools",
                "drive,sheets,docs,slides",
              ],
            },
            readiness: {
              type: "tcp",
              host: "127.0.0.1",
              port: 7353,
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

  it("only emits Drive egress when only the Drive local tool is selected", () => {
    const compiled = compileGoogleWorkspaceBinding(
      createCompileInput({
        mcpServers: [GoogleWorkspaceMcpServerIds.DRIVE],
      }),
    );

    expect(compiled.egressRoutes.map((route) => route.upstream.baseUrl)).toEqual([
      "https://www.googleapis.com/drive/v3",
    ]);
    expect(compiled.egressRoutes.map((route) => route.match)).toEqual([
      {
        hosts: ["www.googleapis.com"],
        pathPrefixes: ["/drive/v3"],
      },
    ]);
    expect(compiled.runtimeClients[0]?.processes[0]?.command.args).toContain("drive");
  });

  it("uses local gws routes when Gmail, Calendar, Chat, and People tools are selected", () => {
    const compiled = compileGoogleWorkspaceBinding(
      createCompileInput({
        mcpServers: [
          GoogleWorkspaceMcpServerIds.GMAIL,
          GoogleWorkspaceMcpServerIds.CALENDAR,
          GoogleWorkspaceMcpServerIds.CHAT,
          GoogleWorkspaceMcpServerIds.PEOPLE,
        ],
      }),
    );

    expect(compiled.egressRoutes.map((route) => route.upstream.baseUrl)).toEqual([
      "https://gmail.googleapis.com/gmail/v1",
      "https://www.googleapis.com/calendar/v3",
      "https://chat.googleapis.com/v1",
      "https://people.googleapis.com/v1",
    ]);
    expect(compiled.egressRoutes.map((route) => route.match)).toEqual([
      {
        hosts: ["gmail.googleapis.com"],
        pathPrefixes: ["/gmail/v1"],
      },
      {
        hosts: ["www.googleapis.com"],
        pathPrefixes: ["/calendar/v3"],
      },
      {
        hosts: ["chat.googleapis.com"],
        pathPrefixes: ["/v1"],
      },
      {
        hosts: ["people.googleapis.com"],
        pathPrefixes: ["/v1"],
      },
    ]);
    expect(compiled.artifacts).toHaveLength(1);
    expect(compiled.runtimeClients[0]?.processes[0]?.command.args).toContain(
      "gmail,calendar,chat,people",
    );
  });

  it("builds non-overlapping routes for all selected Google Workspace MCP servers", () => {
    const compiled = compileGoogleWorkspaceBinding(
      createCompileInput({
        mcpServers: [
          GoogleWorkspaceMcpServerIds.GMAIL,
          GoogleWorkspaceMcpServerIds.DRIVE,
          GoogleWorkspaceMcpServerIds.SHEETS,
          GoogleWorkspaceMcpServerIds.DOCS,
          GoogleWorkspaceMcpServerIds.SLIDES,
          GoogleWorkspaceMcpServerIds.CALENDAR,
          GoogleWorkspaceMcpServerIds.CHAT,
          GoogleWorkspaceMcpServerIds.PEOPLE,
        ],
      }),
    );

    expect(compiled.egressRoutes).toHaveLength(8);
    const routes = compiled.egressRoutes.map(
      (route, index): EgressCredentialRoute => ({
        egressRuleId: `egress_rule_google_workspace_${String(index)}`,
        bindingId: "ibd_123",
        familyId: "google-workspace",
        variantId: "google-workspace-mcp",
        ...route,
      }),
    );

    for (const [leftIndex, left] of routes.entries()) {
      for (const [rightIndex, right] of routes.entries()) {
        if (leftIndex >= rightIndex) {
          continue;
        }

        expect(
          routesOverlap({
            left,
            right,
          }),
        ).toBe(false);
      }
    }
  });
});
