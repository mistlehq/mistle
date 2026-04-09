import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createIntegrationRegistry } from "@mistle/integrations-definitions/server";
import { describe, expect, it } from "vitest";

import {
  discoverIntegrationTargetProvisionManifestPath,
  IntegrationTargetsProvisionManifestJsonEnvVarName,
  IntegrationTargetsProvisionManifestPathEnvVarName,
  loadIntegrationTargetsProvisionManifest,
  parseIntegrationTargetsProvisionManifest,
  resolveRepositoryRootFromDirectory,
} from "./provision-integration-targets.js";
import { SyncIntegrationTargetsForTests } from "./sync-integration-targets.js";

describe("provision-integration-targets", () => {
  it("parses a valid integration target provision manifest", () => {
    const parsedManifest = parseIntegrationTargetsProvisionManifest(
      JSON.stringify({
        version: 1,
        targets: [
          {
            targetKey: "openai-default",
            enabled: true,
            config: {
              api_base_url: "https://api.openai.com",
            },
            secrets: {},
          },
        ],
      }),
      {},
    );

    expect(parsedManifest).toEqual({
      version: 1,
      targets: [
        {
          targetKey: "openai-default",
          enabled: true,
          config: {
            api_base_url: "https://api.openai.com",
          },
          secrets: {},
        },
      ],
    });
  });

  it("rejects duplicate target keys in provision manifest", () => {
    expect(() =>
      parseIntegrationTargetsProvisionManifest(
        JSON.stringify({
          version: 1,
          targets: [
            {
              targetKey: "github-cloud",
              enabled: true,
              config: {},
              secrets: {},
            },
            {
              targetKey: "github-cloud",
              enabled: false,
              config: {},
              secrets: {},
            },
          ],
        }),
        {},
      ),
    ).toThrow(/Duplicate provision target key 'github-cloud'\./u);
  });

  it("normalizes escaped newline sequences in config and secrets", () => {
    const parsedManifest = parseIntegrationTargetsProvisionManifest(
      JSON.stringify({
        version: 1,
        targets: [
          {
            targetKey: "example-target",
            enabled: true,
            config: {
              secret_preview: "line-1\\nline-2\\r\\nline-3",
            },
            secrets: {
              secret_blob: "-----BEGIN KEY-----\\nabc\\r\\ndef\\n-----END KEY-----",
            },
          },
        ],
      }),
      {},
    );

    expect(parsedManifest).toEqual({
      version: 1,
      targets: [
        {
          targetKey: "example-target",
          enabled: true,
          config: {
            secret_preview: "line-1\nline-2\r\nline-3",
          },
          secrets: {
            secret_blob: "-----BEGIN KEY-----\nabc\r\ndef\n-----END KEY-----",
          },
        },
      ],
    });
  });

  it("normalizes double-escaped newline sequences in config and secrets", () => {
    const parsedManifest = parseIntegrationTargetsProvisionManifest(
      JSON.stringify({
        version: 1,
        targets: [
          {
            targetKey: "example-target",
            enabled: true,
            config: {
              secret_preview: "line-1\\\\nline-2\\\\r\\\\nline-3",
            },
            secrets: {
              secret_blob: "-----BEGIN KEY-----\\\\nabc\\\\r\\\\ndef\\\\n-----END KEY-----",
            },
          },
        ],
      }),
      {},
    );

    expect(parsedManifest).toEqual({
      version: 1,
      targets: [
        {
          targetKey: "example-target",
          enabled: true,
          config: {
            secret_preview: "line-1\nline-2\r\nline-3",
          },
          secrets: {
            secret_blob: "-----BEGIN KEY-----\nabc\r\ndef\n-----END KEY-----",
          },
        },
      ],
    });
  });

  it("resolves repository root and discovers provision manifest while walking parents", async () => {
    const temporaryWorkspaceRoot = await mkdtemp(join(tmpdir(), "mistle-provision-manifest-"));
    const repoRoot = join(temporaryWorkspaceRoot, "repo");
    const nestedWorkingDirectory = join(repoRoot, "apps", "control-plane-api");
    const manifestPath = join(repoRoot, "integration-targets.provision.json");

    await mkdir(join(repoRoot, ".git"), { recursive: true });
    await mkdir(nestedWorkingDirectory, { recursive: true });
    await writeFile(
      manifestPath,
      JSON.stringify({
        version: 1,
        targets: [],
      }),
      "utf8",
    );

    try {
      const resolvedRepositoryRoot = resolveRepositoryRootFromDirectory(nestedWorkingDirectory);
      expect(resolvedRepositoryRoot).toBe(repoRoot);

      const discoveredManifestPath = discoverIntegrationTargetProvisionManifestPath({
        startDirectory: nestedWorkingDirectory,
        repositoryRoot: resolvedRepositoryRoot,
      });
      expect(discoveredManifestPath).toBe(manifestPath);
    } finally {
      await rm(temporaryWorkspaceRoot, { recursive: true, force: true });
    }
  });

  it("resolves provision target secrets from secretEnv", () => {
    const parsedManifest = parseIntegrationTargetsProvisionManifest(
      JSON.stringify({
        version: 1,
        targets: [
          {
            targetKey: "example-target",
            enabled: true,
            config: {},
            secretEnv: {
              api_key: "MISTLE_EXAMPLE_TARGET_API_KEY",
            },
          },
        ],
      }),
      {
        MISTLE_EXAMPLE_TARGET_API_KEY: "sk-example\\nline-two",
      },
    );

    expect(parsedManifest).toEqual({
      version: 1,
      targets: [
        {
          targetKey: "example-target",
          enabled: true,
          config: {},
          secrets: {
            api_key: "sk-example\nline-two",
          },
        },
      ],
    });
  });

  it("keeps the example provision manifest target keys aligned with the integration registry", async () => {
    const rawExampleManifest = await readFile(
      new URL("../../../../integration-targets.provision.example.json", import.meta.url),
      "utf8",
    );
    const parsedExampleManifest = parseIntegrationTargetsProvisionManifest(rawExampleManifest, {});
    const integrationRegistry = createIntegrationRegistry();
    const expectedTargetKeys = SyncIntegrationTargetsForTests.buildSyncIntegrationTargets(
      integrationRegistry,
    )
      .map((target) => target.targetKey)
      .sort();

    const actualTargetKeys = parsedExampleManifest.targets.map((target) => target.targetKey).sort();

    expect(actualTargetKeys).toEqual(expectedTargetKeys);
  });

  it("rejects provision targets that specify both secrets and secretEnv", () => {
    expect(() =>
      parseIntegrationTargetsProvisionManifest(
        JSON.stringify({
          version: 1,
          targets: [
            {
              targetKey: "example-target",
              enabled: true,
              config: {},
              secrets: {
                api_key: "sk-example",
              },
              secretEnv: {
                api_key: "MISTLE_EXAMPLE_TARGET_API_KEY",
              },
            },
          ],
        }),
        {
          MISTLE_EXAMPLE_TARGET_API_KEY: "sk-live",
        },
      ),
    ).toThrow(/Provide exactly one of 'secrets' or 'secretEnv'/u);
  });

  it("rejects missing secretEnv variables", () => {
    expect(() =>
      parseIntegrationTargetsProvisionManifest(
        JSON.stringify({
          version: 1,
          targets: [
            {
              targetKey: "example-target",
              enabled: true,
              config: {},
              secretEnv: {
                api_key: "MISTLE_EXAMPLE_TARGET_API_KEY",
              },
            },
          ],
        }),
        {},
      ),
    ).toThrow(
      /Missing integration target secret environment variable 'MISTLE_EXAMPLE_TARGET_API_KEY'/u,
    );
  });

  it("loads a manifest from the JSON environment variable before checking paths", async () => {
    const temporaryWorkspaceRoot = await mkdtemp(join(tmpdir(), "mistle-provision-manifest-"));
    const repoRoot = join(temporaryWorkspaceRoot, "repo");
    const nestedWorkingDirectory = join(repoRoot, "apps", "control-plane-api");

    await mkdir(join(repoRoot, ".git"), { recursive: true });
    await mkdir(nestedWorkingDirectory, { recursive: true });

    try {
      const loadedManifest = loadIntegrationTargetsProvisionManifest({
        env: {
          [IntegrationTargetsProvisionManifestJsonEnvVarName]: JSON.stringify({
            version: 1,
            targets: [
              {
                targetKey: "openai-default",
                enabled: true,
                config: {
                  api_base_url: "https://api.openai.com",
                },
              },
            ],
          }),
        },
        startDirectory: nestedWorkingDirectory,
        repositoryRoot: repoRoot,
      });

      expect(loadedManifest).toEqual({
        source: "env-json",
        sourceValue: IntegrationTargetsProvisionManifestJsonEnvVarName,
        manifest: {
          version: 1,
          targets: [
            {
              targetKey: "openai-default",
              enabled: true,
              config: {
                api_base_url: "https://api.openai.com",
              },
              secrets: {},
            },
          ],
        },
      });
    } finally {
      await rm(temporaryWorkspaceRoot, { recursive: true, force: true });
    }
  });

  it("loads a manifest from the path environment variable", async () => {
    const temporaryWorkspaceRoot = await mkdtemp(join(tmpdir(), "mistle-provision-manifest-"));
    const manifestPath = join(temporaryWorkspaceRoot, "integration-targets.custom.json");

    await writeFile(
      manifestPath,
      JSON.stringify({
        version: 1,
        targets: [
          {
            targetKey: "openai-default",
            enabled: true,
            config: {
              api_base_url: "https://api.openai.com",
            },
          },
        ],
      }),
      "utf8",
    );

    try {
      const loadedManifest = loadIntegrationTargetsProvisionManifest({
        env: {
          [IntegrationTargetsProvisionManifestPathEnvVarName]: manifestPath,
        },
        startDirectory: temporaryWorkspaceRoot,
      });

      expect(loadedManifest).toEqual({
        source: "env-path",
        sourceValue: manifestPath,
        manifest: {
          version: 1,
          targets: [
            {
              targetKey: "openai-default",
              enabled: true,
              config: {
                api_base_url: "https://api.openai.com",
              },
              secrets: {},
            },
          ],
        },
      });
    } finally {
      await rm(temporaryWorkspaceRoot, { recursive: true, force: true });
    }
  });
});
