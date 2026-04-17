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

  it("discovers provision manifest while walking parents without requiring git metadata", async () => {
    const temporaryWorkspaceRoot = await mkdtemp(join(tmpdir(), "mistle-provision-manifest-"));
    const runtimeRoot = join(temporaryWorkspaceRoot, "runtime");
    const nestedWorkingDirectory = join(runtimeRoot, "apps", "control-plane-api");
    const manifestPath = join(runtimeRoot, "integration-targets.provision.json");

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
      const discoveredManifestPath = discoverIntegrationTargetProvisionManifestPath({
        startDirectory: nestedWorkingDirectory,
        searchRootDirectory: runtimeRoot,
      });
      expect(discoveredManifestPath).toBe(manifestPath);
    } finally {
      await rm(temporaryWorkspaceRoot, { recursive: true, force: true });
    }
  });

  it("discovers manifests within a git checkout by default", async () => {
    const temporaryWorkspaceRoot = await mkdtemp(join(tmpdir(), "mistle-provision-manifest-"));
    const repoRoot = join(temporaryWorkspaceRoot, "repo");
    const packageDirectory = join(repoRoot, "apps", "control-plane-api", "scripts");
    const manifestPath = join(repoRoot, "integration-targets.provision.json");

    await mkdir(packageDirectory, { recursive: true });
    await writeFile(join(repoRoot, ".git"), "", "utf8");
    await writeFile(
      manifestPath,
      JSON.stringify({
        version: 1,
        targets: [],
      }),
      "utf8",
    );

    try {
      const discoveredManifestPath = discoverIntegrationTargetProvisionManifestPath({
        startDirectory: packageDirectory,
      });
      expect(discoveredManifestPath).toBe(manifestPath);
    } finally {
      await rm(temporaryWorkspaceRoot, { recursive: true, force: true });
    }
  });

  it("returns undefined when no provision manifest exists in any parent directory", async () => {
    const temporaryWorkspaceRoot = await mkdtemp(join(tmpdir(), "mistle-provision-manifest-"));
    const startDirectory = join(temporaryWorkspaceRoot, "runtime", "apps", "control-plane-api");

    await mkdir(startDirectory, { recursive: true });

    try {
      expect(
        discoverIntegrationTargetProvisionManifestPath({
          startDirectory,
          searchRootDirectory: temporaryWorkspaceRoot,
        }),
      ).toBeUndefined();
      expect(
        loadIntegrationTargetsProvisionManifest({
          env: {},
          startDirectory,
          searchRootDirectory: temporaryWorkspaceRoot,
        }),
      ).toBeUndefined();
    } finally {
      await rm(temporaryWorkspaceRoot, { recursive: true, force: true });
    }
  });

  it("does not discover manifests above the configured search root boundary", async () => {
    const temporaryWorkspaceRoot = await mkdtemp(join(tmpdir(), "mistle-provision-manifest-"));
    const parentManifestPath = join(temporaryWorkspaceRoot, "integration-targets.provision.json");
    const runtimeRoot = join(temporaryWorkspaceRoot, "runtime");
    const nestedWorkingDirectory = join(runtimeRoot, "apps", "control-plane-api");

    await mkdir(nestedWorkingDirectory, { recursive: true });
    await writeFile(
      parentManifestPath,
      JSON.stringify({
        version: 1,
        targets: [],
      }),
      "utf8",
    );

    try {
      expect(
        discoverIntegrationTargetProvisionManifestPath({
          startDirectory: nestedWorkingDirectory,
          searchRootDirectory: runtimeRoot,
        }),
      ).toBeUndefined();
      expect(
        loadIntegrationTargetsProvisionManifest({
          env: {},
          startDirectory: nestedWorkingDirectory,
          searchRootDirectory: runtimeRoot,
        }),
      ).toBeUndefined();
    } finally {
      await rm(temporaryWorkspaceRoot, { recursive: true, force: true });
    }
  });

  it("returns undefined when default discovery is used outside a git checkout", async () => {
    const temporaryWorkspaceRoot = await mkdtemp(join(tmpdir(), "mistle-provision-manifest-"));
    const parentManifestPath = join(temporaryWorkspaceRoot, "integration-targets.provision.json");
    const externalWorkingDirectory = join(temporaryWorkspaceRoot, "outside", "runner");

    await mkdir(externalWorkingDirectory, { recursive: true });
    await writeFile(
      parentManifestPath,
      JSON.stringify({
        version: 1,
        targets: [],
      }),
      "utf8",
    );

    try {
      expect(
        discoverIntegrationTargetProvisionManifestPath({
          startDirectory: externalWorkingDirectory,
        }),
      ).toBeUndefined();
      expect(
        loadIntegrationTargetsProvisionManifest({
          env: {},
          startDirectory: externalWorkingDirectory,
        }),
      ).toBeUndefined();
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
