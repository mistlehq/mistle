import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  discoverIntegrationTargetProvisionManifestPath,
  parseIntegrationTargetsProvisionManifest,
  resolveRepositoryRootFromDirectory,
} from "./provision-integration-targets.js";

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
      ),
    ).toThrowError(/Duplicate provision target key 'github-cloud'\./u);
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
});
