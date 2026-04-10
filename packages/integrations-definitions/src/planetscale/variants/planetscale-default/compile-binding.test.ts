import type { RuntimeArtifactCommand } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import {
  compilePlanetScaleBinding,
  type PlanetScaleCompileBindingInput,
} from "./compile-binding.js";
import { PlanetScaleToolIds, type PlanetScaleToolId } from "./tool-ids.js";

function createCompileInput(
  tools: ReadonlyArray<PlanetScaleToolId>,
): PlanetScaleCompileBindingInput {
  return {
    organizationId: "org_123",
    sandboxProfileId: "sbp_123",
    version: 1,
    targetKey: "planetscale-default",
    target: {
      familyId: "planetscale",
      variantId: "planetscale-default",
      enabled: true,
      config: {
        client_id: "ps_client_123",
      },
      secrets: {
        client_secret: "ps_secret_123",
      },
    },
    connection: {
      id: "icn_123",
      status: "active",
      config: {
        connection_method: "oauth2-authorization-code",
      },
    },
    binding: {
      id: "ibd_123",
      kind: "connector",
      config: {
        tools: [...tools],
      },
    },
    refs: {
      sandboxPaths: {
        userHomeDir: "/root",
        workspaceDir: "/root",
        runtimeDataDir: "/var/lib/mistle",
        runtimeArtifactDir: "/var/lib/mistle/artifacts",
        runtimeArtifactBinDir: "/usr/local/bin",
      },
      artifactBinPath: (name: string) => `/usr/local/bin/${name}`,
    },
  };
}

describe("compilePlanetScaleBinding", () => {
  it("always builds the PlanetScale API egress route", () => {
    const compiled = compilePlanetScaleBinding(createCompileInput([]));

    expect(compiled.egressRoutes).toEqual([
      {
        match: {
          hosts: ["api.planetscale.com"],
        },
        upstream: {
          baseUrl: "https://api.planetscale.com",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          connectionId: "icn_123",
          secretType: "oauth2_access_token",
          slotKey: "planetscale.planetscale-default.oauth2-authorization-code.access-token",
        },
      },
    ]);
    expect(compiled.artifacts).toEqual([]);
    expect(compiled.runtimeClients).toEqual([]);
  });

  it("adds CLI, full MCP, and insights-only MCP support when selected", () => {
    const compiled = compilePlanetScaleBinding(
      createCompileInput([
        PlanetScaleToolIds.PLANETSCALE_CLI,
        PlanetScaleToolIds.PLANETSCALE_MCP,
        PlanetScaleToolIds.PLANETSCALE_INSIGHTS_MCP,
      ]),
    );

    expect(compiled.egressRoutes).toEqual([
      {
        match: {
          hosts: ["api.planetscale.com"],
        },
        upstream: {
          baseUrl: "https://api.planetscale.com",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          connectionId: "icn_123",
          secretType: "oauth2_access_token",
          slotKey: "planetscale.planetscale-default.oauth2-authorization-code.access-token",
        },
      },
      {
        match: {
          hosts: ["mcp.pscale.dev"],
        },
        upstream: {
          baseUrl: "https://mcp.pscale.dev/mcp/planetscale",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          connectionId: "icn_123",
          secretType: "oauth2_access_token",
          slotKey: "planetscale.planetscale-default.oauth2-authorization-code.access-token",
        },
      },
      {
        match: {
          hosts: ["mcp.pscale.dev"],
        },
        upstream: {
          baseUrl: "https://mcp.pscale.dev/mcp/planetscale-insights-only",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          connectionId: "icn_123",
          secretType: "oauth2_access_token",
          slotKey: "planetscale.planetscale-default.oauth2-authorization-code.access-token",
        },
      },
    ]);

    expect(compiled.artifacts).toHaveLength(1);
    expect(compiled.artifacts[0]).toMatchObject({
      artifactKey: "planetscale-cli",
      name: "PlanetScale CLI",
    });

    const artifact = compiled.artifacts[0];
    if (artifact === undefined) {
      throw new Error("Expected PlanetScale CLI artifact to be present.");
    }

    const installHook = artifact.lifecycle.install;
    if (typeof installHook !== "function") {
      throw new Error("Expected PlanetScale CLI artifact to expose an install builder.");
    }

    const installCommands = installHook({
      refs: {
        command: {
          exec: (input: RuntimeArtifactCommand) => input,
        },
        sandboxPaths: {
          userHomeDir: "/root",
          workspaceDir: "/root",
          runtimeDataDir: "/var/lib/mistle",
          runtimeArtifactDir: "/var/lib/mistle/artifacts",
          runtimeArtifactBinDir: "/usr/local/bin",
        },
        artifactBinPath: (name: string) => `/usr/local/bin/${name}`,
        mise: {
          install() {
            throw new Error("mise install should not be used in this test");
          },
        },
        githubReleases: {
          installLatestBinary() {
            throw new Error("GitHub release binary helper should not be used in this test");
          },
          installLatestTaggedAsset() {
            throw new Error("GitHub tagged asset helper should not be used in this test");
          },
        },
        compileContext: {
          organizationId: "org_123",
          sandboxProfileId: "sbp_123",
          version: 1,
          targetKey: "planetscale-default",
          bindingId: "ibd_123",
        },
      },
    });

    expect(installCommands).toEqual([
      expect.objectContaining({
        args: [
          "sh",
          "-euc",
          expect.stringContaining('asset_name="pscale_${version}_${asset_suffix}.tar.gz"'),
        ],
        timeoutMs: 120000,
      }),
    ]);

    expect(compiled.runtimeClients).toEqual([
      {
        clientId: "planetscale-cli-runtime",
        setup: {
          env: {},
          files: [
            {
              fileId: "planetscale_cli_wrapper",
              path: "/usr/local/bin/pscale",
              mode: 0o755,
              content: [
                "#!/bin/sh",
                "set -eu",
                'exec /usr/local/bin/pscale-managed --api-token mistle-managed-oauth "$@"',
              ].join("\n"),
            },
          ],
        },
        processes: [],
        endpoints: [],
      },
    ]);
  });
});
