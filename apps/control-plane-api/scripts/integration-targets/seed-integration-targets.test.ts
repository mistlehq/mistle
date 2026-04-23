import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createIntegrationRegistry } from "@mistle/integrations-definitions/server";
import { describe, expect, it } from "vitest";

import {
  discoverIntegrationTargetsManifestPath,
  IntegrationTargetsManifestJsonEnvVarName,
  IntegrationTargetsManifestPathEnvVarName,
  loadIntegrationTargetsManifest,
  parseIntegrationTargetsManifest,
} from "./seed-integration-targets.js";
import { SyncIntegrationTargetsForTests } from "./sync-integration-targets.js";

describe("seed-integration-targets", () => {
  it("parses a valid integration target manifest", () => {
    const parsedManifest = parseIntegrationTargetsManifest(
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
        },
      ],
    });
  });

  it("rejects duplicate target keys in the manifest", () => {
    expect(() =>
      parseIntegrationTargetsManifest(
        JSON.stringify({
          version: 1,
          targets: [
            {
              targetKey: "github-cloud",
              enabled: true,
              config: {},
            },
            {
              targetKey: "github-cloud",
              enabled: false,
              config: {},
            },
          ],
        }),
      ),
    ).toThrow(/Duplicate manifest target key 'github-cloud'\./u);
  });

  it("normalizes escaped newline sequences in config", () => {
    const parsedManifest = parseIntegrationTargetsManifest(
      JSON.stringify({
        version: 1,
        targets: [
          {
            targetKey: "example-target",
            enabled: true,
            config: {
              secret_preview: "line-1\\nline-2\\r\\nline-3",
            },
          },
        ],
      }),
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
        },
      ],
    });
  });

  it("normalizes double-escaped newline sequences in config", () => {
    const parsedManifest = parseIntegrationTargetsManifest(
      JSON.stringify({
        version: 1,
        targets: [
          {
            targetKey: "example-target",
            enabled: true,
            config: {
              secret_preview: "line-1\\\\nline-2\\\\r\\\\nline-3",
            },
          },
        ],
      }),
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
        },
      ],
    });
  });

  it("discovers the manifest while walking parents without requiring git metadata", async () => {
    const temporaryWorkspaceRoot = await mkdtemp(join(tmpdir(), "mistle-integration-targets-"));
    const runtimeRoot = join(temporaryWorkspaceRoot, "runtime");
    const nestedWorkingDirectory = join(runtimeRoot, "apps", "control-plane-api");
    const manifestPath = join(runtimeRoot, "integration-targets.json");

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
      const discoveredManifestPath = discoverIntegrationTargetsManifestPath({
        startDirectory: nestedWorkingDirectory,
        searchRootDirectory: runtimeRoot,
      });
      expect(discoveredManifestPath).toBe(manifestPath);
    } finally {
      await rm(temporaryWorkspaceRoot, { recursive: true, force: true });
    }
  });

  it("discovers manifests within a git checkout by default", async () => {
    const temporaryWorkspaceRoot = await mkdtemp(join(tmpdir(), "mistle-integration-targets-"));
    const repoRoot = join(temporaryWorkspaceRoot, "repo");
    const packageDirectory = join(repoRoot, "apps", "control-plane-api", "scripts");
    const manifestPath = join(repoRoot, "integration-targets.json");

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
      const discoveredManifestPath = discoverIntegrationTargetsManifestPath({
        startDirectory: packageDirectory,
      });
      expect(discoveredManifestPath).toBe(manifestPath);
    } finally {
      await rm(temporaryWorkspaceRoot, { recursive: true, force: true });
    }
  });

  it("returns undefined when no manifest exists in any parent directory", async () => {
    const temporaryWorkspaceRoot = await mkdtemp(join(tmpdir(), "mistle-integration-targets-"));
    const startDirectory = join(temporaryWorkspaceRoot, "runtime", "apps", "control-plane-api");

    await mkdir(startDirectory, { recursive: true });

    try {
      expect(
        discoverIntegrationTargetsManifestPath({
          startDirectory,
          searchRootDirectory: temporaryWorkspaceRoot,
        }),
      ).toBeUndefined();
      expect(
        loadIntegrationTargetsManifest({
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
    const temporaryWorkspaceRoot = await mkdtemp(join(tmpdir(), "mistle-integration-targets-"));
    const parentManifestPath = join(temporaryWorkspaceRoot, "integration-targets.json");
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
        discoverIntegrationTargetsManifestPath({
          startDirectory: nestedWorkingDirectory,
          searchRootDirectory: runtimeRoot,
        }),
      ).toBeUndefined();
      expect(
        loadIntegrationTargetsManifest({
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
    const temporaryWorkspaceRoot = await mkdtemp(join(tmpdir(), "mistle-integration-targets-"));
    const parentManifestPath = join(temporaryWorkspaceRoot, "integration-targets.json");
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
        discoverIntegrationTargetsManifestPath({
          startDirectory: externalWorkingDirectory,
        }),
      ).toBeUndefined();
      expect(
        loadIntegrationTargetsManifest({
          env: {},
          startDirectory: externalWorkingDirectory,
        }),
      ).toBeUndefined();
    } finally {
      await rm(temporaryWorkspaceRoot, { recursive: true, force: true });
    }
  });

  it("keeps the tracked manifest target keys aligned with the integration registry", async () => {
    const rawManifest = await readFile(
      new URL("../../../../integration-targets.json", import.meta.url),
      "utf8",
    );
    const parsedManifest = parseIntegrationTargetsManifest(rawManifest);
    const integrationRegistry = createIntegrationRegistry();
    const expectedTargetKeys = SyncIntegrationTargetsForTests.buildSyncIntegrationTargets(
      integrationRegistry,
    )
      .map((target) => target.targetKey)
      .sort();

    const actualTargetKeys = parsedManifest.targets.map((target) => target.targetKey).sort();

    expect(actualTargetKeys).toEqual(expectedTargetKeys);
  });

  it("rejects unexpected target secret fields in the tracked manifest", () => {
    expect(() =>
      parseIntegrationTargetsManifest(
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
            },
          ],
        }),
      ),
    ).toThrow(/Unrecognized key/u);
  });

  it("loads a manifest from the JSON environment variable before checking paths", async () => {
    const temporaryWorkspaceRoot = await mkdtemp(join(tmpdir(), "mistle-integration-targets-"));
    const repoRoot = join(temporaryWorkspaceRoot, "repo");
    const nestedWorkingDirectory = join(repoRoot, "apps", "control-plane-api");

    await mkdir(nestedWorkingDirectory, { recursive: true });

    try {
      const loadedManifest = loadIntegrationTargetsManifest({
        env: {
          [IntegrationTargetsManifestJsonEnvVarName]: JSON.stringify({
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
        sourceValue: IntegrationTargetsManifestJsonEnvVarName,
        manifest: {
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
        },
      });
    } finally {
      await rm(temporaryWorkspaceRoot, { recursive: true, force: true });
    }
  });

  it("loads a manifest from the path environment variable", async () => {
    const temporaryWorkspaceRoot = await mkdtemp(join(tmpdir(), "mistle-integration-targets-"));
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
      const loadedManifest = loadIntegrationTargetsManifest({
        env: {
          [IntegrationTargetsManifestPathEnvVarName]: manifestPath,
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
            },
          ],
        },
      });
    } finally {
      await rm(temporaryWorkspaceRoot, { recursive: true, force: true });
    }
  });
});
